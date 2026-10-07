import { listDeployments } from "../lib/dokploy";
import { resolveRepo } from "../lib/git-host";
import type { repositories } from "db";
import { resolveDokployConfig } from "./deploy";

type Repo = typeof repositories.$inferSelect;

export type DeployedCommit = {
  sha: string;
  /**
   * live: the site reports it itself. dokploy: Dokploy recorded the commit
   * it built. branch: the newest commit on the branch when Dokploy's last
   * successful deploy started — what it cloned, unless someone pushed in
   * the seconds between.
   */
  source: "live" | "dokploy" | "branch";
  detail: string;
};

/** The newest commit on a branch at a moment, through the host's API. */
async function commitAt(repo: Repo, at: string): Promise<string | null> {
  const host = await resolveRepo(repo.githubUrl, repo.organizationId);
  return host
    ? host.api.commitAt(repo.defaultBranch, at).catch(() => null)
    : null;
}

/**
 * Which commit is in production. The site's own word first (health
 * endpoint), else Dokploy: the commit its last successful deploy recorded,
 * or the branch's newest commit when that deploy started. Works for sites
 * that do not report a commit yet.
 */
export async function resolveDeployedCommit(
  repo: Repo,
  liveCommit: string | null
): Promise<DeployedCommit | null> {
  if (liveCommit && /^[0-9a-f]{7,40}$/i.test(liveCommit))
    return { sha: liveCommit, source: "live", detail: "reported by the site" };
  if (!repo.dokployApplicationId) return null;
  const cfg = await resolveDokployConfig(repo.organizationId);
  if (!cfg.ok) return null;
  const deployments = await listDeployments({
    ...cfg.config,
    applicationId: repo.dokployApplicationId,
    kind: repo.dokployKind,
  });
  const live = deployments?.find((d) => d.status === "done");
  if (!live) return null;
  if (live.commit)
    return {
      sha: live.commit,
      source: "dokploy",
      detail: `recorded by Dokploy for the deploy of ${live.createdAt}`,
    };
  if (!live.createdAt) return null;
  const sha = await commitAt(repo, live.createdAt);
  return sha
    ? {
        sha,
        source: "branch",
        detail: `newest commit on ${repo.defaultBranch} when Dokploy's last successful deploy started (${live.createdAt})`,
      }
    : null;
}
