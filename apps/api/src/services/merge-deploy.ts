import { eq } from "drizzle-orm";
import { db, repositories, updateRuns } from "db";
import { resolveRepo } from "../lib/git-host";
import { notify } from "../lib/notify";
import { deployRepository } from "./deploy";
import { hasDeployTarget } from "./platforms";

export type MergeOutcome =
  | { ok: true; deployed: boolean; deployError?: string }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string };

/**
 * Merge a run's pull request on its Git host (squash), then deploy it with
 * Dokploy — one click instead of the host, then the Dokploy application.
 * Branch protection and required checks on the host still apply.
 */
export async function mergeAndDeploy(
  runId: string,
  organizationId: string,
  opts: { deploy: boolean }
): Promise<MergeOutcome> {
  const [row] = await db
    .select({ run: updateRuns, repo: repositories })
    .from(updateRuns)
    .innerJoin(repositories, eq(updateRuns.repositoryId, repositories.id))
    .where(eq(updateRuns.id, runId));
  if (!row || row.repo.organizationId !== organizationId)
    return { ok: false, status: 404, error: "Run not found" };
  const { run, repo } = row;
  if (run.merged || run.status === "merged" || run.status === "deployed")
    return { ok: false, status: 409, error: "Already merged." };
  if (!run.prNumber)
    return { ok: false, status: 400, error: "This run has no pull request." };
  const parsed = await resolveRepo(repo.githubUrl, organizationId);
  if (!parsed)
    return { ok: false, status: 400, error: "Not a repository URL." };
  if (!parsed.token)
    return {
      ok: false,
      status: 400,
      error: `No ${parsed.label} token configured.`,
    };

  const merge = await parsed.api.mergePr(run.prNumber);
  const log = run.logOutput ? [run.logOutput] : [];
  if (!merge.ok) {
    return {
      ok: false,
      status: merge.notMergeable ? 409 : 502,
      error: merge.error,
    };
  }
  log.push(
    `Merged on ${parsed.label}${merge.sha ? ` (${merge.sha.slice(0, 7)})` : ""}.`
  );
  await db
    .update(updateRuns)
    .set({
      status: "merged",
      merged: true,
      mergeSha: merge.sha ?? null,
      logOutput: log.join("\n\n"),
    })
    .where(eq(updateRuns.id, runId));

  // The branch just moved: scan it now, not on the next schedule.
  void import("./scan").then(({ runScan }) => runScan(repo.id)).catch(() => {});

  if (!opts.deploy || !hasDeployTarget(repo)) {
    await notify(organizationId, {
      type: "autofix_merged",
      title: `PR merged for ${repo.name}`,
      message: "Merged to the default branch.",
      url: run.prUrl ?? repo.githubUrl,
    }).catch(() => {});
    return { ok: true, deployed: false };
  }

  await db
    .update(updateRuns)
    .set({ status: "deploying" })
    .where(eq(updateRuns.id, runId));
  const deploy = await deployRepository(repo.id, runId, { afterMerge: true });
  log.push(
    deploy.ok ? "Deploy started in Dokploy." : `Deploy failed: ${deploy.error}`
  );
  await db
    .update(updateRuns)
    .set({
      status: deploy.ok ? "deployed" : "merged",
      logOutput: log.join("\n\n"),
    })
    .where(eq(updateRuns.id, runId));
  return deploy.ok
    ? { ok: true, deployed: true }
    : { ok: true, deployed: false, deployError: deploy.error };
}
