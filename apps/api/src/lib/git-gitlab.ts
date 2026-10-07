import {
  encodePath,
  foldChecks,
  getJson,
  hostFetch,
  isSha,
  withAuth,
  type Credentials,
  type GitApi,
  type HostBranch,
  type HostRepo,
  type MergedPr,
  type RepoRef,
} from "./git-api";

/** GitLab (gitlab.com or self-hosted), REST API v4. */

type Mr = {
  iid: number;
  title: string;
  web_url: string;
  draft?: boolean;
  work_in_progress?: boolean;
  created_at: string;
  author?: { username?: string } | null;
  source_branch: string;
  state: string;
  sha?: string | null;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
};

const L = "GitLab";

function headersFor(token: string | null): Record<string, string> {
  return {
    Accept: "application/json",
    ...(token ? { "PRIVATE-TOKEN": token } : {}),
  };
}

const errText = async (res: Response) =>
  `GitLab ${res.status}: ${(await res.text()).slice(0, 200)}`;

export function gitlabApi(ref: RepoRef, creds: Credentials): GitApi {
  const token = creds.token;
  const project = `${ref.origin}/api/v4/projects/${encodeURIComponent(ref.path)}`;
  const headers = headersFor(token);
  const json = { ...headers, "Content-Type": "application/json" };
  const get = <T>(path: string) => getJson<T>(L, `${project}${path}`, headers);
  const branch = (name: string) =>
    get<{ commit?: { id?: string } }>(
      `/repository/branches/${encodeURIComponent(name)}`
    );
  const sha = async (at: string) =>
    isSha(at) ? at : ((await branch(at))?.commit?.id ?? null);
  const findOpen = async (head: string, base: string) => {
    const rows = await get<Mr[]>(
      `/merge_requests?state=opened&source_branch=${encodeURIComponent(head)}&target_branch=${encodeURIComponent(base)}`
    );
    return rows?.[0] ?? null;
  };

  return {
    kind: "gitlab",
    async readFile(filePath, at) {
      const res = await fetch(
        `${project}/repository/files/${encodeURIComponent(filePath.replace(/^\/+/, ""))}/raw?ref=${encodeURIComponent(at)}`,
        { headers, signal: AbortSignal.timeout(30_000) }
      ).catch(() => null);
      if (!res) return { ok: false, status: 0, error: "GitLab did not answer" };
      return res.ok
        ? { ok: true, text: await res.text() }
        : {
            ok: false,
            status: res.status,
            error: (await res.text()).slice(0, 200) || res.statusText,
          };
    },
    async branchHead(name) {
      const id = (await branch(name))?.commit?.id;
      return id && /^[0-9a-f]{40}$/i.test(id) ? id.toLowerCase() : null;
    },
    async commitAt(name, at) {
      const rows = await get<Array<{ id?: string }>>(
        `/repository/commits?ref_name=${encodeURIComponent(name)}&until=${encodeURIComponent(at)}&per_page=1`
      );
      return rows?.[0]?.id ?? null;
    },
    async listOpenPrs() {
      const rows = await get<Mr[]>(`/merge_requests?state=opened&per_page=100`);
      return (
        rows?.map((m) => ({
          number: m.iid,
          title: m.title,
          url: m.web_url,
          author: m.author?.username ?? null,
          draft: !!(m.draft ?? m.work_in_progress),
          createdAt: m.created_at,
          headRef: m.source_branch,
          headSha: m.sha ?? null,
        })) ?? null
      );
    },
    async getPr(number) {
      const m = await get<Mr>(`/merge_requests/${number}`);
      if (!m) return null;
      return {
        state:
          m.state === "merged"
            ? "merged"
            : m.state === "opened" || m.state === "locked"
              ? "open"
              : "closed",
        mergeSha: m.merge_commit_sha ?? m.squash_commit_sha ?? null,
      };
    },
    async createPr(opts) {
      try {
        const res = await hostFetch(L, `${project}/merge_requests`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            source_branch: opts.head,
            target_branch: opts.base,
            title: opts.title,
            description: opts.body,
          }),
        });
        if (res.status === 201) {
          const m = (await res.json()) as Mr;
          return { ok: true, number: m.iid, url: m.web_url };
        }
        const text = await errText(res);
        // 409: one is already open for this branch.
        const existing = await findOpen(opts.head, opts.base);
        if (existing)
          return {
            ok: true,
            number: existing.iid,
            url: existing.web_url,
            alreadyExists: true,
          };
        return { ok: false, error: text };
      } catch (e) {
        const existing = await findOpen(opts.head, opts.base).catch(() => null);
        if (existing)
          return {
            ok: true,
            number: existing.iid,
            url: existing.web_url,
            alreadyExists: true,
          };
        return {
          ok: false,
          error: e instanceof Error ? e.message : "GitLab did not answer",
        };
      }
    },
    async mergePr(number, opts) {
      const res = await hostFetch(
        L,
        `${project}/merge_requests/${number}/merge`,
        {
          method: "PUT",
          headers: json,
          body: JSON.stringify({
            squash: true,
            ...(opts?.sha ? { sha: opts.sha } : {}),
          }),
        }
      );
      if (res.ok) {
        const m = (await res.json()) as Mr;
        return {
          ok: true,
          sha: m.merge_commit_sha ?? m.squash_commit_sha ?? undefined,
        };
      }
      const text = await errText(res);
      // 405: pipeline, approvals or a draft hold it; 406: conflicts.
      if (res.status === 405 || res.status === 406 || res.status === 422)
        return {
          ok: false,
          error: `Not mergeable – pipeline, approvals or conflicts: ${text}`,
          notMergeable: true,
        };
      if (res.status === 409)
        return { ok: false, error: `The branch moved: ${text}` };
      return { ok: false, error: text };
    },
    async checks(at) {
      const commit = await sha(at);
      if (!commit) return { state: "none", detail: "commit not found" };
      const rows = await get<
        Array<{ name?: string; status?: string; allow_failure?: boolean }>
      >(`/repository/commits/${commit}/statuses?per_page=100`);
      if (!rows) return { state: "none", detail: "CI status not readable" };
      return foldChecks(
        rows.map((s) => ({
          name: s.name ?? "job",
          state:
            s.status === "success" ||
            s.status === "skipped" ||
            s.status === "manual" ||
            (s.status === "failed" && s.allow_failure)
              ? "success"
              : s.status === "failed" || s.status === "canceled"
                ? "failure"
                : "pending",
        }))
      );
    },
    async revertTip(name, commit, message) {
      const tip = (await branch(name))?.commit?.id;
      if (!tip) return { ok: false, error: `Branch ${name} not found.` };
      if (tip !== commit)
        return {
          ok: false,
          moved: true,
          error: `${name} has moved on since ${commit.slice(0, 7)} — not reverted automatically.`,
        };
      const res = await hostFetch(
        L,
        `${project}/repository/commits/${commit}/revert`,
        {
          method: "POST",
          headers: json,
          body: JSON.stringify({ branch: name, message }),
        }
      );
      if (!res.ok)
        return {
          ok: false,
          error: `Could not revert on ${name} (branch protection?): ${await errText(res)}`,
        };
      const c = (await res.json()) as { id: string };
      return { ok: true, sha: c.id };
    },
    async listBranches() {
      const out: HostBranch[] = [];
      for (let page = 1; page <= 3; page++) {
        const rows = await get<
          Array<{
            name: string;
            merged?: boolean;
            protected?: boolean;
            default?: boolean;
            commit: { id: string; committed_date?: string };
          }>
        >(`/repository/branches?per_page=100&page=${page}`);
        if (!rows) {
          if (page === 1) throw new Error("GitLab did not list the branches");
          break;
        }
        for (const b of rows)
          out.push({
            name: b.name,
            sha: b.commit.id,
            date: b.commit.committed_date ?? null,
            protected: !!b.protected || !!b.default,
            merged: !!b.merged,
          });
        if (rows.length < 100) break;
      }
      return out;
    },
    async compareBranch(head, base) {
      const c = await get<{ commits?: unknown[] }>(
        `/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}&straight=false`
      );
      return Array.isArray(c?.commits)
        ? { merged: c.commits.length === 0, date: null }
        : null;
    },
    async changedFiles(base, head) {
      const c = await get<{ diffs?: Array<{ new_path: string }> }>(
        `/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}&straight=false`
      );
      return c?.diffs ? c.diffs.map((d) => d.new_path) : null;
    },
    async mergedPrs() {
      const out = new Map<string, MergedPr>();
      const rows = await get<Mr[]>(
        `/merge_requests?state=merged&per_page=100&order_by=updated_at`
      );
      for (const m of rows ?? []) {
        if (out.has(m.source_branch)) continue;
        out.set(m.source_branch, {
          number: m.iid,
          url: m.web_url,
          mergedAt: m.merged_at ?? null,
          headSha: m.sha ?? null,
        });
      }
      return out;
    },
    async deleteBranch(name) {
      const res = await hostFetch(
        L,
        `${project}/repository/branches/${encodeURIComponent(name)}`,
        { method: "DELETE", headers }
      );
      return res.status === 204 || res.ok
        ? { ok: true }
        : { ok: false, error: await errText(res) };
    },
    compareUrl: (base, head) =>
      `${ref.origin}/${encodePath(ref.path)}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(head)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`,
    cloneUrl: () => withAuth(ref.origin, ref.path, "oauth2", token),
  };
}

/** Projects the token is a member of, newest activity first. */
export async function gitlabRepos(
  origin: string,
  creds: Credentials
): Promise<HostRepo[]> {
  const out: HostRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await hostFetch(
      L,
      `${origin}/api/v4/projects?membership=true&archived=false&order_by=last_activity_at&per_page=100&page=${page}`,
      { headers: headersFor(creds.token), timeoutMs: 20_000 }
    );
    if (!res.ok) throw new Error(await errText(res));
    const rows = (await res.json()) as Array<{
      path_with_namespace: string;
      web_url: string;
      default_branch?: string | null;
      visibility?: string;
      last_activity_at?: string | null;
      description?: string | null;
    }>;
    for (const p of rows)
      out.push({
        fullName: p.path_with_namespace,
        url: p.web_url,
        defaultBranch: p.default_branch ?? "main",
        private: p.visibility !== "public",
        pushedAt: p.last_activity_at ?? null,
        description: p.description ?? null,
        language: null,
      });
    if (rows.length < 100) break;
  }
  return out;
}

/** Who the token belongs to — the connection test. */
export async function gitlabWhoami(
  origin: string,
  creds: Credentials
): Promise<string> {
  const res = await hostFetch(L, `${origin}/api/v4/user`, {
    headers: headersFor(creds.token),
    timeoutMs: 15_000,
  });
  if (!res.ok) throw new Error(await errText(res));
  return ((await res.json()) as { username: string }).username;
}
