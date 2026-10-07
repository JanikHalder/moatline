import pLimit from "p-limit";
import { and, desc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, deployRuns, repositories } from "db";
import { runLiveCheck } from "./live-check";
import { listDeployments } from "../lib/dokploy";
import { resolveDokployConfig } from "./deploy";

const EVERY_MS = 5 * 60 * 1000;
/** A site that just failed is checked every minute — incidents need it. */
const FAILING_EVERY_MS = 60 * 1000;

/**
 * Look at every live URL every 15 minutes: up or down, and what its health
 * endpoint says about the app's configuration (`checks`). One GET each.
 */
export async function runDueLiveChecks(): Promise<void> {
  const due = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(
      and(
        isNotNull(repositories.liveUrl),
        or(
          isNull(repositories.liveCheckedAt),
          lt(repositories.liveCheckedAt, new Date(Date.now() - EVERY_MS)),
          and(
            gt(repositories.liveFailures, 0),
            lt(
              repositories.liveCheckedAt,
              new Date(Date.now() - FAILING_EVERY_MS + 5000)
            )
          )
        )
      )
    )
    .limit(100);
  // A few at a time: one site timing out must not hold up the others.
  const limit = pLimit(8);
  await Promise.all(
    due.map((r) =>
      limit(() =>
        runLiveCheck(r.id).catch((e) =>
          console.error("[live] check failed:", e)
        )
      )
    )
  );
}

/** Longer than any watch takes (10 min window + 2 min stability + slack). */
const WATCH_STALE_MS = 20 * 60 * 1000;

/**
 * A watch runs inside this process; a restart (deploying Moatline
 * itself, say) ends it without a result, and the deploy would read
 * "watching…" forever. Close those with one honest look at the URL now —
 * no rollback on that basis, the moment has passed.
 */
export async function closeInterruptedWatches(): Promise<void> {
  const open = await db
    .select({
      id: deployRuns.id,
      repositoryId: deployRuns.repositoryId,
      liveUrl: repositories.liveUrl,
    })
    .from(deployRuns)
    .innerJoin(repositories, eq(deployRuns.repositoryId, repositories.id))
    .where(
      and(
        eq(deployRuns.status, "succeeded"),
        isNull(deployRuns.liveOk),
        isNotNull(repositories.liveUrl),
        lt(deployRuns.triggeredAt, new Date(Date.now() - WATCH_STALE_MS))
      )
    )
    .limit(50);
  for (const d of open) {
    const check = await runLiveCheck(d.repositoryId).catch(() => null);
    const state = check?.ok ? check.state : null;
    const up = state?.liveStatus === "up";
    await db
      .update(deployRuns)
      .set({
        liveOk: up,
        liveDetail: `The watch was cut off (Moatline restarted). Checked afterwards: ${
          up
            ? `the URL answers${state?.liveCommit ? `, commit ${state.liveCommit}` : ""}.`
            : `the URL does not answer${state?.liveError ? ` (${state.liveError})` : ""}.`
        }`,
        liveVerifiedAt: new Date(),
      })
      .where(eq(deployRuns.id, d.id));
  }
}

/**
 * A deploy recorded as failed, while Dokploy has since deployed the app
 * successfully (a retry, or a redeploy started in Dokploy itself): the
 * failure is history, not the state of the site — say so on the run.
 */
export async function reconcileFailedDeploys(
  repositoryId?: string
): Promise<void> {
  const failed = await db
    .select({ run: deployRuns, repo: repositories })
    .from(deployRuns)
    .innerJoin(repositories, eq(deployRuns.repositoryId, repositories.id))
    .where(
      and(
        eq(deployRuns.liveOk, false),
        isNotNull(repositories.dokployApplicationId),
        repositoryId ? eq(repositories.id, repositoryId) : undefined,
        gt(
          deployRuns.triggeredAt,
          new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
        )
      )
    )
    .limit(50);
  for (const { run, repo } of failed) {
    // Only the newest deploy of a repository says anything about it now.
    const [newest] = await db
      .select({ id: deployRuns.id })
      .from(deployRuns)
      .where(eq(deployRuns.repositoryId, repo.id))
      .orderBy(desc(deployRuns.triggeredAt))
      .limit(1);
    if (newest?.id !== run.id) continue;
    const cfg = await resolveDokployConfig(repo.organizationId);
    if (!cfg.ok) continue;
    const deployments = await listDeployments({
      ...cfg.config,
      applicationId: repo.dokployApplicationId!,
      kind: repo.dokployKind,
    }).catch(() => null);
    const later = deployments?.find(
      (d) =>
        d.status === "done" &&
        d.createdAt &&
        Date.parse(d.createdAt) > run.triggeredAt.getTime() - 60_000
    );
    if (!later) continue;
    await db
      .update(deployRuns)
      .set({
        liveOk: true,
        guard: run.guard === "rolled_back" ? run.guard : "healthy",
        liveDetail: `Dokploy deployed successfully on a later attempt (${later.createdAt}) — the failed attempt was replaced.`,
        liveVerifiedAt: new Date(),
      })
      .where(eq(deployRuns.id, run.id));
  }
}
