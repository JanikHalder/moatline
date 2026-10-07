import {
  createPullRequest,
  getRefChecks,
  ghFetch,
  mergePullRequest,
  revertTipCommit,
} from "./github";
import {
  encodePath,
  getJson,
  withAuth,
  type Credentials,
  type GitApi,
  type HostBranch,
  type MergedPr,
  type RepoRef,
} from "./git-api";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

type GhPr = {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  created_at: string;
  user?: { login?: string } | null;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  state?: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
};

export function githubApi(ref: RepoRef, creds: Credentials): GitApi {
  const { owner, repo } = ref;
  const token = creds.token;
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const get = <T>(path: string) =>
    getJson<T>("GitHub", `${base}${path}`, headers);

  const readPublic = async (filePath: string, at: string) => {
    const res = await fetch(
      `${RAW}/${owner}/${repo}/${at}/${filePath.replace(/^\/+/, "")}`,
      {
        signal: AbortSignal.timeout(30_000),
      }
    ).catch(() => null);
    if (!res)
      return { ok: false as const, status: 0, error: "GitHub did not answer" };
    return res.ok
      ? { ok: true as const, text: await res.text() }
      : { ok: false as const, status: res.status, error: res.statusText };
  };

  return {
    kind: "github",
    async readFile(filePath, at) {
      if (!token) return readPublic(filePath, at);
      const res = await fetch(
        `${base}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(at)}`,
        {
          headers: { ...headers, Accept: "application/vnd.github.raw" },
          signal: AbortSignal.timeout(30_000),
        }
      ).catch(() => null);
      if (!res) return { ok: false, status: 0, error: "GitHub did not answer" };
      if (res.ok) return { ok: true, text: await res.text() };
      // A broken or expired token must not break public repos.
      if (res.status === 401) {
        const pub = await readPublic(filePath, at);
        if (pub.ok) return pub;
      }
      return {
        ok: false,
        status: res.status,
        error: (await res.text()).slice(0, 200) || res.statusText,
      };
    },
    async branchHead(branch) {
      try {
        const res = await fetch(
          `${base}/commits/${encodeURIComponent(branch)}`,
          {
            headers: { ...headers, Accept: "application/vnd.github.sha" },
            signal: AbortSignal.timeout(15_000),
          }
        );
        if (!res.ok) return null;
        const sha = (await res.text()).trim();
        return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
      } catch {
        return null;
      }
    },
    async commitAt(branch, at) {
      const rows = await get<Array<{ sha?: string }>>(
        `/commits?sha=${encodeURIComponent(branch)}&until=${encodeURIComponent(at)}&per_page=1`
      );
      return rows?.[0]?.sha ?? null;
    },
    async listOpenPrs() {
      const open = await get<GhPr[]>(`/pulls?state=open&per_page=100`);
      return (
        open?.map((p) => ({
          number: p.number,
          title: p.title,
          url: p.html_url,
          author: p.user?.login ?? null,
          draft: !!p.draft,
          createdAt: p.created_at,
          headRef: p.head?.ref ?? "",
          headSha: p.head?.sha ?? null,
        })) ?? null
      );
    },
    async getPr(number) {
      const pr = await get<GhPr>(`/pulls/${number}`);
      if (!pr) return null;
      return {
        state:
          pr.state !== "closed" ? "open" : pr.merged_at ? "merged" : "closed",
        mergeSha: pr.merge_commit_sha ?? null,
      };
    },
    createPr: (opts) =>
      token
        ? createPullRequest(token, owner, repo, opts)
        : Promise.resolve({ ok: false, error: "No GitHub token." }),
    mergePr: (number, opts) =>
      token
        ? mergePullRequest(token, owner, repo, number, {
            method: "squash",
            sha: opts?.sha,
          })
        : Promise.resolve({ ok: false, error: "No GitHub token." }),
    checks: (at) =>
      token
        ? getRefChecks(token, owner, repo, at)
        : Promise.resolve({
            state: "none",
            detail: "no GitHub token to read CI",
          }),
    revertTip: (branch, sha, message) =>
      token
        ? revertTipCommit(token, owner, repo, branch, sha, message)
        : Promise.resolve({ ok: false, error: "No GitHub token." }),
    async listBranches() {
      const out: HostBranch[] = [];
      for (let page = 1; page <= 3; page++) {
        const rows = await get<
          Array<{ name: string; commit: { sha: string }; protected?: boolean }>
        >(`/branches?per_page=100&page=${page}`);
        if (!rows) {
          if (page === 1) throw new Error("GitHub did not list the branches");
          break;
        }
        for (const b of rows)
          out.push({
            name: b.name,
            sha: b.commit.sha,
            date: null,
            protected: !!b.protected,
          });
        if (rows.length < 100) break;
      }
      return out;
    },
    async compareBranch(head, baseBranch) {
      type C = { commit?: { committer?: { date?: string } } };
      const c = await get<{
        ahead_by?: number;
        commits?: C[];
        merge_base_commit?: C;
      }>(
        `/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(head)}?per_page=100`
      );
      if (typeof c?.ahead_by !== "number") return null;
      const merged = c.ahead_by === 0;
      // Merged: head is the merge base. Ahead: its newest commit is last.
      const tip = merged ? c.merge_base_commit : c.commits?.at(-1);
      return { merged, date: tip?.commit?.committer?.date ?? null };
    },
    async changedFiles(b, head) {
      const c = await get<{ files?: Array<{ filename: string }> }>(
        `/compare/${encodeURIComponent(b)}...${encodeURIComponent(head)}?per_page=300`
      );
      return c?.files ? c.files.map((f) => f.filename) : null;
    },
    async mergedPrs() {
      const out = new Map<string, MergedPr>();
      const rows = await get<GhPr[]>(
        `/pulls?state=closed&per_page=100&sort=updated&direction=desc`
      );
      for (const p of rows ?? []) {
        const head = p.head?.ref;
        // A fork's branch of the same name is not ours.
        if (!head || !p.merged_at || out.has(head)) continue;
        if (
          p.head?.repo?.full_name &&
          p.head.repo.full_name.toLowerCase() !==
            `${owner}/${repo}`.toLowerCase()
        )
          continue;
        out.set(head, {
          number: p.number,
          url: p.html_url,
          mergedAt: p.merged_at,
          headSha: p.head?.sha ?? null,
        });
      }
      return out;
    },
    async deleteBranch(name) {
      if (!token) return { ok: false, error: "No GitHub token." };
      const res = await ghFetch(`${base}/git/refs/heads/${encodePath(name)}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      if (res.status === 204) return { ok: true };
      return {
        ok: false,
        error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    },
    compareUrl: (b, head) =>
      `https://github.com/${owner}/${repo}/compare/${encodeURI(b)}...${encodeURI(head)}?expand=1`,
    cloneUrl: () => withAuth(ref.origin, ref.path, "x-access-token", token),
  };
}
