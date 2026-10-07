import { eq } from "drizzle-orm";
import { db, deployRuns, repositories, updateRuns } from "db";
import { resolveRepo } from "../lib/git-host";
import { notify } from "../lib/notify";
import type { DeployVerdict } from "./live-check";
import { emitEvent } from "../lib/events";

type Repo = typeof repositories.$inferSelect;

export type RollbackOutcome = { ok: boolean; detail: string };

/**
 * Go back to the version before a deploy:
 *
 * 1. Dokploy's own rollback, when it kept the previous image (rollbacks
 *    enabled on the application) — instant, no rebuild. Only when the new
 *    build is actually serving; after a failed build the old one still is.
 * 2. A revert commit of the merge on the default branch, through the GitHub
 *    API — so the branch builds again and the next deploy does not bring the
 *    breakage back. Only while the merge is still the tip of the branch.
 *    With no Dokploy rollback, the revert is then deployed.
 */
export async function rollbackDeploy(
  deployRunId: string,
  reason: "build_failed" | "broken" | "error_spike" | "manual"
): Promise<RollbackOutcome> {
  const [row] = await db
    .select({ run: deployRuns, repo: repositories })
    .from(deployRuns)
    .innerJoin(repositories, eq(deployRuns.repositoryId, repositories.id))
    .where(eq(deployRuns.id, deployRunId));
  if (!row) return { ok: false, detail: "Deploy not found." };
  const { run, repo } = row;
  const steps: string[] = [];
  let restored = reason === "build_failed"; // the old build never left

  // Lazy import: deploy.ts imports this module.
  const { deployRepository } = await import("./deploy");
  const { platform, repoTarget } = await import("./platforms");
  const target = repoTarget(repo);

  // The platform's own rollback first, when it kept the previous build.
  if (!restored && target) {
    const rb = await platform(target.platform)
      .rollback(repo.organizationId, target)
      .catch(() => null);
    if (rb) {
      steps.push(rb.detail);
      if (rb.ok) restored = true;
    }
  }

  const [update] = run.updateRunId
    ? await db
        .select()
        .from(updateRuns)
        .where(eq(updateRuns.id, run.updateRunId))
    : [];
  let reverted = false;
  if (update?.mergeSha) {
    const parsed = await resolveRepo(repo.githubUrl, repo.organizationId);
    if (parsed?.token) {
      const res = await parsed.api.revertTip(
        repo.defaultBranch,
        update.mergeSha,
        `Revert "${update.branchName}" — the deploy ${reason === "build_failed" ? "did not build" : reason === "error_spike" ? "made the errors jump" : "broke the live site"} (Moatline)`
      );
      if (res.ok) {
        reverted = true;
        steps.push(
          `Reverted ${update.mergeSha.slice(0, 7)} on ${repo.defaultBranch} (${res.sha.slice(0, 7)}).`
        );
      } else {
        steps.push(res.error);
      }
    }
  } else if (!restored) {
    steps.push(
      "No merge from Moatline to revert — this deploy was started by hand."
    );
  }

  if (!restored && reverted && target) {
    const redeploy = await deployRepository(repo.id, null, {
      afterMerge: true,
      guard: false,
    });
    if (redeploy.ok) {
      restored = true;
      steps.push("Deploying the reverted state.");
    } else {
      steps.push(`Redeploy failed: ${redeploy.error}`);
    }
  }

  // After a failed build nothing needed restoring; without a revert the
  // branch still holds the change that does not build.
  const guard =
    reason === "build_failed" && !reverted
      ? "build_failed"
      : restored
        ? "rolled_back"
        : "rollback_failed";
  if (reason === "build_failed")
    steps.push("The previous version kept running throughout.");
  await db
    .update(deployRuns)
    .set({ guard, guardDetail: steps.join(" ") })
    .where(eq(deployRuns.id, deployRunId));
  emitEvent(repo.organizationId, {
    name: `deploy.${guard}`,
    title: `Deploy of ${repo.name}: ${guard.replace("_", " ")}`,
    severity: restored ? "warn" : "error",
    repository: repo,
    attributes: { "deploy.id": deployRunId, reason, detail: steps.join(" ") },
  });
  return { ok: restored, detail: steps.join(" ") };
}

/**
 * The new version is live: analyse it again, so the dashboard shows what is
 * deployed now rather than what was before. The deployed commit when the
 * live URL reports one, else the branch (which is what was just deployed).
 */
async function rescanAfterDeploy(repo: Repo): Promise<void> {
  // A deploy can bring the seed route back or drop a header: look again.
  const { probeSite } = await import("./site-probe");
  await probeSite(repo.id).catch(() => null);
  // Did the deploy make it slower? Mobile only: that is what Google ranks.
  const { runPerf } = await import("./perf");
  void runPerf(repo.id, { trigger: "deploy", strategies: ["mobile"] }).catch(
    () => null
  );
  // Lazy imports: the scan chain imports the deploy path.
  const { startLiveScan } = await import("./live-scan");
  const live = await startLiveScan(repo.id).catch(() => null);
  if (live?.ok) return;
  const { runScan } = await import("./scan");
  await runScan(repo.id).catch((e) =>
    console.error("[api] scan after deploy failed:", e)
  );
}

/** Act on what the watch found after a deploy. */
export async function guardDeploy(
  repo: Repo,
  deployRunId: string,
  result: DeployVerdict
): Promise<void> {
  emitEvent(repo.organizationId, {
    name: `deploy.${result.verdict}`,
    title:
      result.verdict === "healthy"
        ? `Deploy of ${repo.name} is live and healthy`
        : `Deploy of ${repo.name}: ${result.verdict.replace("_", " ")}`,
    severity: result.verdict === "healthy" ? "info" : "error",
    repository: repo,
    attributes: { "deploy.id": deployRunId, detail: result.detail },
  });
  if (result.verdict === "healthy") {
    await db
      .update(deployRuns)
      .set({ guard: "healthy", guardDetail: null })
      .where(eq(deployRuns.id, deployRunId));
    await rescanAfterDeploy(repo);
    return;
  }
  await db
    .update(deployRuns)
    .set({ guard: result.verdict, guardDetail: result.detail })
    .where(eq(deployRuns.id, deployRunId));

  const what =
    result.verdict === "build_failed"
      ? "did not go live — the previous version is still running"
      : "broke the live site";
  if (!repo.autoRollback) {
    await notify(repo.organizationId, {
      type: "workflow_failed",
      title: `Deploy of ${repo.name} ${what}`,
      message: `${result.detail} Roll back from the repository page, or turn on automatic rollback.`,
      url: repo.liveUrl ?? repo.githubUrl,
    }).catch(() => {});
    return;
  }
  const rb = await rollbackDeploy(deployRunId, result.verdict);
  await notify(repo.organizationId, {
    type: "workflow_failed",
    title: rb.ok
      ? `Deploy of ${repo.name} ${what} — rolled back`
      : `Deploy of ${repo.name} ${what} — rollback failed`,
    message: `${result.detail}\n${rb.detail}`,
    url: repo.liveUrl ?? repo.githubUrl,
  }).catch(() => {});
}
