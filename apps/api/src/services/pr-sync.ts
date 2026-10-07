import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, repositories, updateRuns } from "db";
import type { GitApi } from "../lib/git-api";

export type OpenPr = {
  number: number;
  title: string;
  url: string;
  author: string | null;
  draft: boolean;
  createdAt: string;
  /** Opened by a Moatline run (its branch). */
  ours: boolean;
};

/** Moatline branches: deps/update-…, security/cve-fix-… */
const OURS = /^(deps\/update-|security\/cve-fix-)/;

/**
 * Bring a repository's pull requests in line with its host: the list of
 * open ones (anyone's), and the state of the PRs Moatline opened — merged
 * or closed there means the run is no longer "open".
 */
export async function syncPullRequests(
  repo: typeof repositories.$inferSelect,
  api: GitApi
): Promise<void> {
  const open = await api.listOpenPrs().catch(() => null);
  if (open) {
    const prs: OpenPr[] = open.map((p) => ({
      number: p.number,
      title: p.title.slice(0, 200),
      url: p.url,
      author: p.author,
      draft: p.draft,
      createdAt: p.createdAt,
      ours: OURS.test(p.headRef),
    }));
    await db
      .update(repositories)
      .set({ openPrs: prs })
      .where(eq(repositories.id, repo.id));
  }

  // Our runs that still think their PR is open.
  const runs = await db
    .select()
    .from(updateRuns)
    .where(
      and(
        eq(updateRuns.repositoryId, repo.id),
        isNotNull(updateRuns.prNumber),
        inArray(updateRuns.status, ["pr_opened", "pushed"]),
        eq(updateRuns.merged, false)
      )
    );
  const openNumbers = new Set((open ?? []).map((p) => p.number));
  for (const run of runs) {
    // Still in the open list: nothing changed.
    if (open && openNumbers.has(run.prNumber!)) continue;
    const pr = await api.getPr(run.prNumber!).catch(() => null);
    if (!pr || pr.state === "open") continue;
    await db
      .update(updateRuns)
      .set(
        pr.state === "merged"
          ? {
              status: "merged",
              merged: true,
              mergeSha: pr.mergeSha,
              currentStep: null,
            }
          : { status: "closed", currentStep: null }
      )
      .where(eq(updateRuns.id, run.id));
  }
}
