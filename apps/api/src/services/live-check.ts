import { eq } from "drizzle-orm";
import { db, repositories, deployRuns } from "db";
import { checkLiveUrl, validateLiveUrl } from "../lib/live-check";
import type { LiveCheckResult, LiveChecks } from "../lib/live-check";
import { notify } from "../lib/notify";
import { onLiveResult } from "./incidents";

export type LiveState = {
  liveUrl: string | null;
  liveStatus: "up" | "down" | null;
  liveHttpStatus: number | null;
  liveCommit: string | null;
  liveError: string | null;
  liveCheckedAt: string | null;
};

/** How long a deploy is watched, and how often the URL is looked at. */
const WATCH_INTERVAL_MS = 20_000;
const WATCH_ATTEMPTS = 30; // ≈10 minutes, enough for an install-and-build

function stateOf(row: typeof repositories.$inferSelect): LiveState {
  return {
    liveUrl: row.liveUrl,
    liveStatus: row.liveStatus,
    liveHttpStatus: row.liveHttpStatus,
    liveCommit: row.liveCommit,
    liveError: row.liveError,
    liveCheckedAt: row.liveCheckedAt?.toISOString() ?? null,
  };
}

/** Checks that were fine and now report false — worth telling someone. */
export function brokenChecks(
  before: LiveChecks | null | undefined,
  now: LiveChecks | null | undefined
): string[] {
  if (!now) return [];
  return Object.entries(now)
    .filter(([k, v]) => v === false && before?.[k] !== false)
    .map(([k]) => k);
}

async function persist(
  repositoryId: string,
  result: LiveCheckResult
): Promise<LiveState | null> {
  const [before] = await db
    .select({
      liveChecks: repositories.liveChecks,
      liveFailures: repositories.liveFailures,
    })
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  const [row] = await db
    .update(repositories)
    .set({
      liveStatus: result.ok ? "up" : "down",
      liveHttpStatus: result.httpStatus,
      liveCommit: result.commit,
      liveError: result.error,
      liveCheckedAt: new Date(),
      liveFailures: result.ok ? 0 : (before?.liveFailures ?? 0) + 1,
      // A failed request says nothing about the configuration: keep the last.
      ...(result.ok ? { liveChecks: result.checks ?? null } : {}),
    })
    .where(eq(repositories.id, repositoryId))
    .returning();
  const broke = result.ok
    ? brokenChecks(before?.liveChecks as LiveChecks | null, result.checks)
    : [];
  if (row && broke.length) {
    await notify(row.organizationId, {
      type: "workflow_failed",
      title: `${row.name}: ${broke.join(", ")} not working`,
      message: `The health endpoint now reports ${broke.map((k) => `${k}: false`).join(", ")}. Check the environment variables in Dokploy — mails or uploads may be failing.`,
      url: row.liveUrl ?? undefined,
    }).catch(() => {});
  }
  if (row)
    await onLiveResult(row, result).catch((e) =>
      console.error("[live] incident handling failed:", e)
    );
  return row ? stateOf(row) : null;
}

export type RunLiveCheckOutcome =
  | { ok: true; state: LiveState }
  | { ok: false; error: string };

/**
 * Look at a repository's live URL now and record what came back. Used by the
 * "check now" button and by the post-deploy watcher.
 */
export async function runLiveCheck(
  repositoryId: string
): Promise<RunLiveCheckOutcome> {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  if (!repo) return { ok: false, error: "Repository not found" };
  if (!repo.liveUrl) {
    return { ok: false, error: "No live URL configured for this repo." };
  }
  const valid = validateLiveUrl(repo.liveUrl);
  if (!valid.ok) return { ok: false, error: valid.reason };

  const result = await checkLiveUrl(repo.liveUrl);
  const state = await persist(repositoryId, result);
  if (!state) return { ok: false, error: "Repository not found" };
  return { ok: true, state };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(result: LiveCheckResult): string {
  if (!result.ok) return result.error ?? "unreachable";
  const status = result.httpStatus ?? 0;
  return `HTTP ${status} in ${result.durationMs}ms${
    result.commit ? `, commit ${result.commit}` : ""
  }`;
}

/**
 * Watch the live URL after a deploy was triggered and record on the deploy run
 * what actually happened out there.
 *
 * Two levels of proof, and the difference matters:
 *
 * - The target reports a commit (see /api/health) and it changes → the new
 *   build is demonstrably serving. This ends the watch early.
 * - It reports no commit → all that can be shown is whether the URL kept
 *   answering, and whether it went away in between. Reported as exactly that,
 *   rather than dressed up as a verified deploy: the old version answering is
 *   indistinguishable from the new one.
 *
 * Runs in the background; the caller does not wait for it.
 */
/**
 * What the watch concluded:
 * - healthy: the new build serves (or, without a commit, the URL answers)
 *   and kept answering for a couple of minutes.
 * - build_failed: the old commit is still serving at the end — the build or
 *   the start failed in Dokploy, which kept the previous version running.
 * - broken: the new build took over and then failed, or the URL is gone.
 */
export type DeployVerdict = {
  verdict: "healthy" | "build_failed" | "broken";
  detail: string;
};

/** After the switch: a few more checks, so a crash on first request counts. */
const STABILITY_CHECKS = 4;
const STABILITY_INTERVAL_MS = 30_000;

/** The site's root next to the health URL: the page visitors get. */
function siteRoot(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? null : `${u.origin}/`;
  } catch {
    return null;
  }
}

/** Same-origin pages to check besides the live URL ("/admin" for Payload). */
function extraUrls(url: string, paths: string[]): string[] {
  try {
    const origin = new URL(url).origin;
    return paths.map((p) => `${origin}${p.startsWith("/") ? p : `/${p}`}`);
  } catch {
    return [];
  }
}

async function stable(
  url: string,
  checks: number,
  intervalMs: number,
  extraPaths: string[] = []
): Promise<{ ok: boolean; detail: string | null }> {
  const targets = [
    ...new Set(
      [url, siteRoot(url), ...extraUrls(url, extraPaths)].filter(
        (u): u is string => !!u
      )
    ),
  ];
  let failures = 0;
  for (let i = 0; i < checks; i++) {
    await sleep(intervalMs);
    const results = await Promise.all(
      targets.map(async (u) => ({ url: u, result: await checkLiveUrl(u) }))
    );
    const bad = results.find((r) => !r.result.ok);
    failures = bad ? failures + 1 : 0;
    // Two failed rounds in a row: not a blip.
    if (failures >= 2)
      return {
        ok: false,
        detail: `${new URL(bad!.url).pathname} — ${describe(bad!.result)}`,
      };
  }
  return { ok: true, detail: null };
}

export async function watchDeployLive(opts: {
  repositoryId: string;
  deployRunId: string;
  organizationId: string;
  repoName: string;
  url: string;
  previousCommit: string | null;
  attempts?: number;
  intervalMs?: number;
  stabilityIntervalMs?: number;
  /** More pages that must answer after the switch, e.g. ["/admin"]. */
  extraPaths?: string[];
  /**
   * Dokploy's own state of this deployment. Ends the wait as soon as it is
   * known — a failed build at once, a finished one without waiting for a
   * commit the site does not report.
   */
  buildStatus?: () => Promise<"running" | "done" | "error" | null>;
}): Promise<DeployVerdict> {
  const attempts = opts.attempts ?? WATCH_ATTEMPTS;
  const intervalMs = opts.intervalMs ?? WATCH_INTERVAL_MS;

  let last: LiveCheckResult | null = null;
  let wasDown = false;
  let commitChanged = false;

  let build: "running" | "done" | "error" | null = null;
  let errorsInARow = 0;
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    if (opts.buildStatus) {
      build = await opts.buildStatus().catch(() => null);
      // Twice in a row: a retry Dokploy starts right away gets its chance.
      errorsInARow = build === "error" ? errorsInARow + 1 : 0;
      if (errorsInARow >= 2) break;
      if (build === "error") continue;
    }
    const result = await checkLiveUrl(opts.url);
    last = result;
    await persist(opts.repositoryId, result).catch(() => null);
    if (!result.ok) {
      wasDown = true;
      continue;
    }
    if (opts.previousCommit && result.commit) {
      if (result.commit !== opts.previousCommit) {
        commitChanged = true;
        break;
      }
      // Same commit as before the deploy: the old build is still answering.
      continue;
    }
    // Nothing to compare: Dokploy's word that it finished, plus an answering
    // URL, is as close as it gets — no point waiting out the window.
    if (build === "done") break;
  }

  if (build === "error") {
    const detail =
      "Dokploy reports the deployment failed — the previous version keeps running. The build log in Dokploy says why.";
    await db
      .update(deployRuns)
      .set({ liveOk: false, liveDetail: detail, liveVerifiedAt: new Date() })
      .where(eq(deployRuns.id, opts.deployRunId))
      .catch(() => {});
    return { verdict: "build_failed", detail };
  }

  // When both commits are known the answer is definitive either way: the
  // build took over, or it demonstrably did not. Only without that comparison
  // does reachability have to stand in for it.
  const comparable = !!opts.previousCommit && !!last?.commit;
  let ok = commitChanged ? true : comparable ? false : (last?.ok ?? false);
  const windowMin = Math.max(1, Math.round((attempts * intervalMs) / 60000));
  const settled = ok
    ? await stable(
        opts.url,
        STABILITY_CHECKS,
        opts.stabilityIntervalMs ?? STABILITY_INTERVAL_MS,
        opts.extraPaths
      )
    : { ok: true, detail: null };
  if (!settled.ok) ok = false;
  const detail = !settled.ok
    ? `The new build came up${commitChanged ? ` (${last!.commit})` : ""}, then stopped answering: ${settled.detail}.`
    : commitChanged
      ? `New build is live — ${describe(last!)} (was ${opts.previousCommit}).`
      : comparable
        ? `The URL answers, but still reports commit ${last!.commit} after ${windowMin} minutes — the new build has not taken over.`
        : last?.ok
          ? `The URL answers${wasDown ? " again" : ""} — ${describe(last)}. No commit is reported, so this shows reachability, not which build is running.`
          : `The URL did not come back within ${windowMin} minutes — ${last ? describe(last) : "no check ran"}.`;

  await db
    .update(deployRuns)
    .set({ liveOk: ok, liveDetail: detail, liveVerifiedAt: new Date() })
    .where(eq(deployRuns.id, opts.deployRunId))
    .catch(() => {});

  // Notifying is the guard's job now: it knows whether it rolled back.
  return {
    verdict: ok
      ? "healthy"
      : !settled.ok || !comparable
        ? "broken"
        : "build_failed",
    detail,
  };
}
