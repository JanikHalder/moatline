import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, deployRuns, logErrorCounts, logErrors, repositories } from "db";
import { notify } from "../lib/notify";
import { emitEvent } from "../lib/events";

/**
 * After a deploy looked healthy, its errors still tell. For a while after
 * each healthy deploy, the app's error lines (agent 1.11.0+) are compared
 * with the day before it: a burst of new errors, or a rate several times
 * the usual one, means the deploy broke something the live check cannot
 * see — and is treated like a broken deploy.
 */

/** How long after a deploy its errors are watched. */
export const SPIKE_WINDOW_MS = 45 * 60 * 1000;
/** Fewer errors than this are never a spike — noise, not breakage. */
export const MIN_ERRORS = 30;
/** Times the usual rate that counts as a spike. */
export const FACTOR = 5;
const DAY = 24 * 60 * 60 * 1000;

export type SpikeInput = {
  /** Errors since the deploy, and over how many minutes. */
  after: number;
  afterMinutes: number;
  /** Errors in the day before it. */
  before: number;
  /** Of `after`: errors of kinds first seen since the deploy. */
  fresh: number;
};

export function judgeSpike(s: SpikeInput): { spike: boolean; detail: string } {
  if (s.fresh >= MIN_ERRORS)
    return {
      spike: true,
      detail: `${s.fresh} errors of kinds that did not exist before the deploy.`,
    };
  const minutes = Math.max(1, s.afterMinutes);
  const afterPerHour = (s.after / minutes) * 60;
  // A quiet app: at least one an hour as the floor, or any error is "5×".
  const usualPerHour = Math.max(s.before / 24, 1);
  if (s.after >= MIN_ERRORS && afterPerHour >= FACTOR * usualPerHour)
    return {
      spike: true,
      detail: `${s.after} errors in ${Math.round(minutes)} minutes — ${Math.round(afterPerHour)} an hour against ${Math.round(usualPerHour)} before the deploy.`,
    };
  return { spike: false, detail: "" };
}

/**
 * Check the repositories whose apps just reported errors. Called with every
 * agent report; acts once per deploy (the guard leaves "healthy").
 */
export async function checkErrorSpikes(
  repositoryIds: string[],
  now = new Date()
): Promise<void> {
  for (const repositoryId of new Set(repositoryIds)) {
    const [run] = await db
      .select()
      .from(deployRuns)
      .where(
        and(
          eq(deployRuns.repositoryId, repositoryId),
          eq(deployRuns.guard, "healthy"),
          gte(deployRuns.triggeredAt, new Date(now.getTime() - SPIKE_WINDOW_MS))
        )
      )
      .orderBy(desc(deployRuns.triggeredAt))
      .limit(1);
    if (!run) continue;
    const since = run.triggeredAt;
    const errors = await db
      .select({ id: logErrors.id, firstSeen: logErrors.firstSeen })
      .from(logErrors)
      .where(eq(logErrors.repositoryId, repositoryId));
    if (!errors.length) continue;
    const ids = errors.map((e) => e.id);
    const freshIds = errors
      .filter((e) => e.firstSeen >= since)
      .map((e) => e.id);
    const sum = async (from: Date, to: Date, only?: string[]) => {
      if (only && !only.length) return 0;
      const [r] = await db
        .select({
          n: sql<number>`coalesce(sum(${logErrorCounts.count}), 0)::int`,
        })
        .from(logErrorCounts)
        .where(
          and(
            inArray(logErrorCounts.errorId, only ?? ids),
            gte(logErrorCounts.recordedAt, from),
            lt(logErrorCounts.recordedAt, to)
          )
        );
      return r?.n ?? 0;
    };
    const verdict = judgeSpike({
      after: await sum(since, now),
      afterMinutes: (now.getTime() - since.getTime()) / 60000,
      before: await sum(new Date(since.getTime() - DAY), since),
      fresh: await sum(since, now, freshIds),
    });
    if (!verdict.spike) continue;
    await actOnSpike(repositoryId, run.id, verdict.detail);
  }
}

async function actOnSpike(
  repositoryId: string,
  deployRunId: string,
  detail: string
): Promise<void> {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  if (!repo) return;
  // Claim it first: two reports at once must not roll back twice.
  const claimed = await db
    .update(deployRuns)
    .set({ guard: "error_spike", guardDetail: detail })
    .where(and(eq(deployRuns.id, deployRunId), eq(deployRuns.guard, "healthy")))
    .returning({ id: deployRuns.id });
  if (!claimed.length) return;
  emitEvent(repo.organizationId, {
    name: "deploy.error_spike",
    title: `Errors jumped after the deploy of ${repo.name}`,
    severity: "error",
    repository: repo,
    attributes: { "deploy.id": deployRunId, detail },
  });
  const url = repo.liveUrl ?? repo.githubUrl;
  if (!repo.autoRollback) {
    await notify(repo.organizationId, {
      type: "workflow_failed",
      title: `Errors jumped after the deploy of ${repo.name}`,
      message: `${detail} Roll back from the repository page, or turn on automatic rollback.`,
      url,
    }).catch(() => {});
    return;
  }
  const { rollbackDeploy } = await import("./deploy-guard");
  const rb = await rollbackDeploy(deployRunId, "error_spike");
  await notify(repo.organizationId, {
    type: "workflow_failed",
    title: rb.ok
      ? `Errors jumped after the deploy of ${repo.name} — rolled back`
      : `Errors jumped after the deploy of ${repo.name} — rollback failed`,
    message: `${detail}\n${rb.detail}`,
    url,
  }).catch(() => {});
}
