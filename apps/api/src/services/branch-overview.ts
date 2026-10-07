import pLimit from "p-limit";
import type { GitApi, HostBranch, MergedPr } from "../lib/git-api";

/**
 * Every branch of a repository and whether it still holds work: merged
 * branches that nobody deleted pile up and keep showing as "open" in tools
 * and editors. Merged means every commit is in the default branch — or the
 * branch's pull request was merged (a squash merge leaves the branch's own
 * commits behind, so only the PR knows).
 */

export type BranchStatus =
  /** The default branch. */
  | "default"
  /** Everything is in the default branch: safe to delete. */
  | "merged"
  /** An open pull request comes from it. */
  | "open_pr"
  /** Commits that are not in the default branch. */
  | "unmerged"
  /** The host could not say. */
  | "unknown";

export type BranchRow = {
  name: string;
  sha: string;
  date: string | null;
  protected: boolean;
  status: BranchStatus;
  /** How it was merged, when a PR did it. */
  mergedPr: { number: number; url: string; mergedAt: string | null } | null;
  openPr: { number: number; url: string; title: string } | null;
  /** A branch Moatline pushed (update or security fix). */
  ours: boolean;
};

/** Compares per overview; more branches stay "unknown". */
const MAX_COMPARES = 100;
const OURS = /^(deps\/update-|security\/cve-fix-)/;

/** Same commit — Bitbucket abbreviates the SHA of a PR's source. */
function sameCommit(a: string | null, b: string): boolean {
  if (!a) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.length >= 7 && (y.startsWith(x) || x.startsWith(y));
}

/** Merged through its pull request, and nothing pushed to it since. */
function viaPr(b: HostBranch, merged: Map<string, MergedPr>): MergedPr | null {
  const pr = merged.get(b.name);
  return pr && sameCommit(pr.headSha, b.sha) ? pr : null;
}

export async function branchOverview(
  api: GitApi,
  defaultBranch: string
): Promise<{ branches: BranchRow[]; truncated: boolean }> {
  const [list, open, merged] = await Promise.all([
    api.listBranches(),
    api.listOpenPrs().catch(() => null),
    api.mergedPrs().catch(() => new Map<string, MergedPr>()),
  ]);
  const openBy = new Map((open ?? []).map((p) => [p.headRef, p]));
  const limit = pLimit(6);
  let compares = 0;
  let truncated = false;

  const rows = await Promise.all(
    list.map((b) =>
      limit(async (): Promise<BranchRow> => {
        const pr = openBy.get(b.name);
        const row: BranchRow = {
          name: b.name,
          sha: b.sha,
          date: b.date,
          protected: b.protected,
          status: "unknown",
          mergedPr: null,
          openPr: pr
            ? { number: pr.number, url: pr.url, title: pr.title }
            : null,
          ours: OURS.test(b.name),
        };
        if (b.name === defaultBranch) return { ...row, status: "default" };
        if (pr) return { ...row, status: "open_pr" };
        const byPr = viaPr(b, merged);
        if (byPr)
          row.mergedPr = {
            number: byPr.number,
            url: byPr.url,
            mergedAt: byPr.mergedAt,
          };
        if (b.merged === true || byPr) return { ...row, status: "merged" };
        // GitLab answered for every branch already; others need a compare.
        if (b.merged === false && b.date) return { ...row, status: "unmerged" };
        if (compares >= MAX_COMPARES) {
          truncated = true;
          return row;
        }
        compares++;
        const c = await api
          .compareBranch(b.name, defaultBranch)
          .catch(() => null);
        if (!c) return row;
        return {
          ...row,
          date: row.date ?? c.date,
          status: c.merged ? "merged" : "unmerged",
        };
      })
    )
  );

  const order: Record<BranchStatus, number> = {
    default: 0,
    merged: 1,
    open_pr: 2,
    unmerged: 3,
    unknown: 4,
  };
  rows.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (a.date ?? "").localeCompare(b.date ?? "")
  );
  return { branches: rows, truncated };
}

/** Whether a branch may be deleted: merged, not default, not protected. */
export function deletable(row: BranchRow): boolean {
  return row.status === "merged" && !row.protected;
}
