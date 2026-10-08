import { Cron } from "croner";
import { checkOverdue } from "./cron-checks";
import pLimit from "p-limit";
import {
  eq,
  and,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  desc,
  or,
} from "drizzle-orm";
import { db, repositories, scans } from "db";
import { runScan, SCAN_HEARTBEAT_MS } from "./scan";
import { startLiveScan } from "./live-scan";
import { runServerTick } from "./server-scheduler";
import { runDueLiveChecks } from "./live-sweep";
import { hasDeployTarget } from "./platforms";
import {
  OVERNIGHT_CRON,
  runOvernightSecurityFixes,
} from "./security-overnight";

/** How often the scheduler looks for repositories that are due. */
export const CHECK_CRON = "*/5 * * * *";

/**
 * A scan still pending/running after this long lost its process (API restart,
 * crash, container redeploy). It is retired so it stops blocking the repo.
 */
const STALE_SCAN_MS = 2 * 60 * 60 * 1000;
/** No heartbeat for this long: the scan's process is gone. */
const SILENT_SCAN_MS = 5 * SCAN_HEARTBEAT_MS;
/** One automatic retry per repository in this window — no crash loops. */
const RETRY_WINDOW_MS = 6 * 60 * 60 * 1000;

export const SCAN_DIED_MESSAGE =
  "The API stopped during the scan (restart, deploy or out of memory).";
const RETRIED = "Started again automatically.";

/**
 * Schedules often share a slot ("daily at 03:00" for every repository).
 * Most scans only read the lockfile, but one without a lockfile clones and
 * installs — a handful of those at once is what used to take the API down.
 */
const scheduledScans = pLimit(2);

// In-process guard so a slow scan isn't re-triggered by the next tick.
const inFlight = new Set<string>();
let masterJob: Cron | null = null;
let liveJob: Cron | null = null;
let overnightJob: Cron | null = null;
let lastCheckAt: Date | null = null;
let lastCheckError: string | null = null;
let scheduledRepoCount = 0;
// Invalid cron patterns are reported once per pattern, not on every tick.
const reportedBadPatterns = new Set<string>();

/**
 * A repo is "due" when a scheduled slot has passed since its last run, i.e.
 * the next scheduled run *after* lastRunAt is already in the past.
 * (croner's previousRun() reports the previous *actual* execution, which is
 * always null here, so we compute from nextRun(lastRunAt) instead.)
 * Exported for testing.
 */
export function isDue(schedule: string, lastRunAt: Date | null): boolean {
  const next = nextRunAt(schedule, lastRunAt);
  return next !== null && next.getTime() <= Date.now();
}

export function isValidSchedule(schedule: string): boolean {
  let c: Cron;
  try {
    c = new Cron(schedule);
  } catch {
    return false;
  }
  c.stop();
  return true;
}

/**
 * When the next scheduled scan is due, given when the repo last ran. Returns
 * null for an invalid pattern, and "now" (a past date) when it is overdue.
 * Used by the API so the UI can show *when* automation will next fire.
 */
export function nextRunAt(
  schedule: string,
  lastRunAt: Date | null
): Date | null {
  let c: Cron;
  try {
    c = new Cron(schedule); // validate the pattern first
  } catch {
    return null; // invalid cron expression
  }
  try {
    // Never scanned → due immediately.
    return c.nextRun(lastRunAt ?? new Date(0));
  } finally {
    c.stop();
  }
}

/**
 * Scans whose process died stay "pending"/"running" forever, and the overlap
 * guard in runDueScans() would then block every future scheduled scan for that
 * repository — the single most common reason "automatic scans stopped
 * working". Retire them before looking for due repos.
 */
async function failStaleScans(): Promise<void> {
  const now = Date.now();
  const stale = await db
    .update(scans)
    .set({
      status: "failed",
      currentStep: null,
      finishedAt: new Date(),
      errorMessage: SCAN_DIED_MESSAGE,
    })
    .where(
      and(
        inArray(scans.status, ["pending", "running"]),
        or(
          lt(scans.heartbeatAt, new Date(now - SILENT_SCAN_MS)),
          // Never got a heartbeat (queued, or from before heartbeats).
          and(
            isNull(scans.heartbeatAt),
            lt(scans.startedAt, new Date(now - STALE_SCAN_MS))
          )
        )
      )
    )
    .returning({
      id: scans.id,
      repositoryId: scans.repositoryId,
      target: scans.target,
      ref: scans.ref,
    });
  if (stale.length === 0) return;
  console.warn(
    `[api] scheduler: retired ${stale.length} scan(s) whose process died`
  );
  // Usually a deploy of this app cut the scan off: start it again, once.
  // A scan that kills the process every time (out of memory) stays failed.
  const retried = new Set<string>();
  for (const s of stale) {
    if (retried.has(s.repositoryId) || inFlight.has(s.repositoryId)) continue;
    const before = await db
      .select({ id: scans.id })
      .from(scans)
      .where(
        and(
          eq(scans.repositoryId, s.repositoryId),
          eq(scans.errorMessage, `${SCAN_DIED_MESSAGE} ${RETRIED}`),
          gt(scans.finishedAt, new Date(now - RETRY_WINDOW_MS))
        )
      )
      .limit(1);
    if (before.length) continue;
    retried.add(s.repositoryId);
    await db
      .update(scans)
      .set({ errorMessage: `${SCAN_DIED_MESSAGE} ${RETRIED}` })
      .where(eq(scans.id, s.id));
    console.log(`[api] scheduler: restarting scan for repo ${s.repositoryId}`);
    inFlight.add(s.repositoryId);
    runScan(
      s.repositoryId,
      undefined,
      s.target === "live" ? { commit: s.ref } : undefined
    )
      .catch((e) => console.error("[api] scan retry error:", e))
      .finally(() => inFlight.delete(s.repositoryId));
  }
}

async function runDueScans(): Promise<void> {
  lastCheckAt = new Date();

  try {
    await failStaleScans();
  } catch (e) {
    console.error("[api] scheduler: could not retire stale scans:", e);
  }

  let repos: (typeof repositories.$inferSelect)[];
  try {
    repos = await db
      .select()
      .from(repositories)
      .where(isNotNull(repositories.scanSchedule));
  } catch (e) {
    lastCheckError = e instanceof Error ? e.message : String(e);
    console.error("[api] scheduler query error:", e);
    return;
  }
  lastCheckError = null;
  scheduledRepoCount = repos.filter((r) => r.scanSchedule?.trim()).length;

  for (const repo of repos) {
    const schedule = repo.scanSchedule?.trim();
    if (!schedule) continue;
    if (inFlight.has(repo.id)) continue;
    if (!isValidSchedule(schedule)) {
      if (!reportedBadPatterns.has(schedule)) {
        reportedBadPatterns.add(schedule);
        console.warn(
          `[api] scheduler: repo ${repo.id} has an invalid cron pattern "${schedule}" – it will never run`
        );
      }
      continue;
    }

    // Most recent scan, whatever its outcome.
    const [last] = await db
      .select({ status: scans.status, startedAt: scans.startedAt })
      .from(scans)
      .where(eq(scans.repositoryId, repo.id))
      .orderBy(desc(scans.startedAt))
      .limit(1);

    // DB overlap guard: never start a scan while one is pending/running.
    if (last && (last.status === "pending" || last.status === "running"))
      continue;

    // Count every *attempt*, not just successes. lastScannedAt is only written
    // on success, so a repo whose scans keep failing would otherwise be
    // retried on every single tick instead of at its next scheduled slot.
    const lastRunAt = mostRecent(repo.lastScannedAt, last?.startedAt ?? null);
    if (!isDue(schedule, lastRunAt)) continue;

    inFlight.add(repo.id);
    console.log(
      `[api] Scheduled scan for repo ${repo.id} (${repo.name}, schedule "${schedule}")`
    );
    scheduledScans(() =>
      runScan(repo.id).then(() =>
        repo.liveUrl || hasDeployTarget(repo)
          ? scanDeployedVersion(repo.id)
          : null
      )
    )
      .catch((e) => console.error("[api] scheduled runScan error:", e))
      .finally(() => inFlight.delete(repo.id));
  }
}

/**
 * The branch scan answers "is it fixed?"; what matters for exposure is what
 * is deployed. With a live URL, every scheduled scan is followed by a scan of
 * the commit the deployment reports — advisories are published for old
 * versions too, so the same commit can become vulnerable without a deploy.
 */
async function scanDeployedVersion(repoId: string): Promise<void> {
  const started = await startLiveScan(repoId);
  if (!started.ok) {
    console.warn(
      `[api] scheduler: no live scan for repo ${repoId}: ${started.error}`
    );
    return;
  }
  await started.done;
}

function mostRecent(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/** Status of the scan scheduler, for the UI and for ops. */
export function getSchedulerStatus(): {
  enabled: boolean;
  checkInterval: string;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  scheduledRepos: number;
  lastError: string | null;
} {
  return {
    enabled: masterJob !== null,
    checkInterval: CHECK_CRON,
    lastCheckAt: lastCheckAt?.toISOString() ?? null,
    nextCheckAt: masterJob?.nextRun()?.toISOString() ?? null,
    scheduledRepos: scheduledRepoCount,
    lastError: lastCheckError,
  };
}

/**
 * Start the scan scheduler. Gated behind ENABLE_SCHEDULER so only ONE api
 * instance runs it (the in-process guards assume a single scheduler).
 */
export function startScheduler(): void {
  if (process.env.ENABLE_SCHEDULER !== "true") {
    console.warn(
      "[api] Scheduler DISABLED – scheduled scans will not run. Set ENABLE_SCHEDULER=true on exactly one instance to enable them."
    );
    return;
  }
  console.log(
    `[api] Scheduler enabled – checking for due scans on "${CHECK_CRON}"; overnight security fixes on "${OVERNIGHT_CRON}".`
  );
  masterJob = new Cron(CHECK_CRON, { protect: true }, () => {
    void runDueScans();
    void runServerTick();
  });
  // Live URLs on their own minute tick: a site that just failed is checked
  // again a minute later, which incidents and self-healing depend on.
  // Returning the promise lets `protect` skip a tick while one still runs.
  liveJob = new Cron("* * * * *", { protect: true }, async () => {
    await Promise.all([
      runDueLiveChecks().catch((e) => console.error("[live] sweep failed:", e)),
      // Scheduled jobs that went silent: the minute matters here too.
      checkOverdue().catch((e) => console.error("[cron-checks] failed:", e)),
    ]);
  });
  overnightJob = new Cron(OVERNIGHT_CRON, { protect: true }, () => {
    void runOvernightSecurityFixes().catch((e) =>
      console.error("[api] overnight security fixes failed:", e)
    );
  });
  // Also sweep shortly after boot so a restart doesn't wait a full interval.
  setTimeout(() => {
    void runDueScans();
    void runServerTick();
  }, 15_000);

  const stop = () => {
    masterJob?.stop();
    masterJob = null;
    liveJob?.stop();
    liveJob = null;
    overnightJob?.stop();
    overnightJob = null;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
