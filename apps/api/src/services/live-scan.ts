import { eq } from "drizzle-orm";
import { db, repositories, scans } from "db";
import { resolveDeployedCommit } from "./deployed-commit";
import { runScan } from "./scan";
import { runLiveCheck } from "./live-check";
import { isCommitSha } from "./clone";

export type LiveScanStart =
  | {
      ok: true;
      scanId: string;
      commit: string;
      /** Where the commit came from: the site, Dokploy, or the branch then. */
      source: "live" | "dokploy" | "branch";
      done: Promise<unknown>;
    }
  | { ok: false; error: string };

/**
 * Scan exactly the commit the deployment reports — what is running, not what
 * the branch says. Asks the deployment first rather than trusting an earlier
 * check: it may have been redeployed since.
 */
export async function startLiveScan(repoId: string): Promise<LiveScanStart> {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId));
  if (!repo) return { ok: false, error: "Repository not found" };
  // The site's own word when it has a live URL that reports one…
  const check = repo.liveUrl ? await runLiveCheck(repoId) : null;
  const reported = check?.ok ? check.state.liveCommit : null;
  // …else what Dokploy deployed last.
  const deployed = await resolveDeployedCommit(repo, reported).catch(
    () => null
  );
  const commit = deployed?.sha ?? reported;
  if (!commit) {
    return {
      ok: false,
      error: repo.dokployApplicationId
        ? "Neither the live URL nor Dokploy says which commit is deployed (no successful Dokploy deploy found). Expose a JSON `commit` field at /api/health, or deploy once through Dokploy."
        : "The live URL reports no commit, and no Dokploy application is linked to look it up. Expose a JSON `commit` field (this app serves one at /api/health), or link the Dokploy application in the settings.",
    };
  }
  if (!isCommitSha(commit)) {
    return {
      ok: false,
      error: `The live URL reports "${commit}", which is not a commit SHA — it cannot be resolved to a version of this repository.`,
    };
  }
  const [scan] = await db
    .insert(scans)
    .values({
      repositoryId: repoId,
      status: "pending",
      target: "live",
      ref: commit,
    })
    .returning();
  if (!scan) return { ok: false, error: "Could not create the scan." };
  console.log(
    `[api] Live scan started: repo=${repoId} scanId=${scan.id} commit=${commit} (${deployed?.source ?? "live"})`
  );
  const done = runScan(repoId, scan.id, { commit }).catch((err) => {
    console.error("[api] runScan (live) error:", err);
  });
  return {
    ok: true,
    scanId: scan.id,
    commit,
    source: deployed?.source ?? "live",
    done,
  };
}
