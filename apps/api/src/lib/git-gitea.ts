import {
  encodePath,
  foldChecks,
  getJson,
  hostFetch,
  withAuth,
  type Credentials,
  type GitApi,
  type HostBranch,
  type HostRepo,
  type MergedPr,
  type RepoRef,
} from "./git-api";

/** Gitea and Forgejo (Codeberg too) — the same API, v1. */

type Pr = {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  created_at: string;
  user?: { login?: string } | null;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  state?: string;
  merged?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
};

const L = "Gitea";

function headersFor(token: string | null): Record<string, string> {
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `token ${token}` } : {}),
  };
}

const errText = async (res: Response) =>
  `Gitea ${res.status}: ${(await res.text()).slice(0, 200)}`;

export function giteaApi(ref: RepoRef, creds: Credentials): GitApi {
  const token = creds.token;
  const base = `${ref.origin}/api/v1/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const headers = headersFor(token);
  const json = { ...headers, "Content-Type": "application/json" };
  const get = <T>(path: string) => getJson<T>(L, `${base}${path}`, headers);
  const findOpen = async (head: string) => {
    const rows = await get<Pr[]>(`/pulls?state=open&limit=50`);
    return rows?.find((p) => p.head?.ref === head) ?? null;
  };

  return {
    kind: "gitea",
    async readFile(filePath, at) {
      const res = await fetch(
        `${base}/raw/${encodePath(filePath)}?ref=${encodeURIComponent(at)}`,
        { headers, signal: AbortSignal.timeout(30_000) }
      ).catch(() => null);
      if (!res) return { ok: false, status: 0, error: "Gitea did not answer" };
      return res.ok
        ? { ok: true, text: await res.text() }
        : {
            ok: false,
            status: res.status,
            error: (await res.text()).slice(0, 200) || res.statusText,
          };
    },
    async branchHead(name) {
      const b = await get<{ commit?: { id?: string } }>(
        `/branches/${encodePath(name)}`
      );
      const id = b?.commit?.id;
      return id && /^[0-9a-f]{40}$/i.test(id) ? id.toLowerCase() : null;
    },
    async commitAt(name, at) {
      // `until` is not on every Gitea version: read a page, pick by date.
      const rows = await get<
        Array<{ sha: string; commit?: { committer?: { date?: string } } }>
      >(
        `/commits?sha=${encodeURIComponent(name)}&limit=50&stat=false&verification=false&files=false`
      );
      const limit = Date.parse(at);
      const hit = rows?.find(
        (c) => Date.parse(c.commit?.committer?.date ?? "") <= limit
      );
      return hit?.sha ?? null;
    },
    async listOpenPrs() {
      const rows = await get<Pr[]>(`/pulls?state=open&limit=50`);
      return (
        rows?.map((p) => ({
          number: p.number,
          title: p.title,
          url: p.html_url,
          author: p.user?.login ?? null,
          draft: !!p.draft || /^(WIP|\[WIP\]|Draft):/i.test(p.title),
          createdAt: p.created_at,
          headRef: p.head?.ref ?? "",
          headSha: p.head?.sha ?? null,
        })) ?? null
      );
    },
    async getPr(number) {
      const p = await get<Pr>(`/pulls/${number}`);
      if (!p) return null;
      return {
        state: p.merged ? "merged" : p.state === "closed" ? "closed" : "open",
        mergeSha: p.merge_commit_sha ?? null,
      };
    },
    async createPr(opts) {
      try {
        const res = await hostFetch(L, `${base}/pulls`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            head: opts.head,
            base: opts.base,
            title: opts.title,
            body: opts.body,
          }),
        });
        if (res.status === 201) {
          const p = (await res.json()) as Pr;
          return { ok: true, number: p.number, url: p.html_url };
        }
        const text = await errText(res);
        const existing = await findOpen(opts.head);
        if (existing)
          return {
            ok: true,
            number: existing.number,
            url: existing.html_url,
            alreadyExists: true,
          };
        if (/no changes|same commit|There are no commits/i.test(text))
          return {
            ok: false,
            error: "No changes to open a PR for.",
            noDiff: true,
          };
        return { ok: false, error: text };
      } catch (e) {
        const existing = await findOpen(opts.head).catch(() => null);
        if (existing)
          return {
            ok: true,
            number: existing.number,
            url: existing.html_url,
            alreadyExists: true,
          };
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Gitea did not answer",
        };
      }
    },
    async mergePr(number, opts) {
      const res = await hostFetch(L, `${base}/pulls/${number}/merge`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          Do: "squash",
          ...(opts?.sha ? { head_commit_id: opts.sha } : {}),
        }),
      });
      if (res.ok) {
        const p = await get<Pr>(`/pulls/${number}`);
        return { ok: true, sha: p?.merge_commit_sha ?? undefined };
      }
      const text = await errText(res);
      if (res.status === 405)
        return {
          ok: false,
          error: `Not mergeable – branch protection, required checks or conflicts: ${text}`,
          notMergeable: true,
        };
      if (res.status === 409)
        return { ok: false, error: `Merge conflict / head moved: ${text}` };
      return { ok: false, error: text };
    },
    async checks(at) {
      const s = await get<{
        state?: string;
        statuses?: Array<{ context?: string; status?: string }> | null;
      }>(`/commits/${encodeURIComponent(at)}/status`);
      if (!s) return { state: "none", detail: "CI status not readable" };
      return foldChecks(
        (s.statuses ?? []).map((x) => ({
          name: x.context ?? "check",
          state:
            x.status === "success" || x.status === "warning"
              ? "success"
              : x.status === "failure" || x.status === "error"
                ? "failure"
                : "pending",
        }))
      );
    },
    async revertTip(name, commit) {
      return {
        ok: false,
        error: `Gitea/Forgejo cannot revert a commit through its API — revert ${commit.slice(0, 7)} on ${name} by hand.`,
      };
    },
    async listBranches() {
      const out: HostBranch[] = [];
      for (let page = 1; page <= 6; page++) {
        const rows = await get<
          Array<{
            name: string;
            protected?: boolean;
            commit: { id: string; timestamp?: string };
          }>
        >(`/branches?limit=50&page=${page}`);
        if (!rows) {
          if (page === 1) throw new Error("Gitea did not list the branches");
          break;
        }
        for (const b of rows)
          out.push({
            name: b.name,
            sha: b.commit.id,
            date: b.commit.timestamp ?? null,
            protected: !!b.protected,
          });
        if (rows.length < 50) break;
      }
      return out;
    },
    async compareBranch(head, baseBranch) {
      // Commits on head that are not on base (Gitea 1.21+, Forgejo).
      const rows = await get<unknown[]>(
        `/commits?sha=${encodeURIComponent(head)}&not=${encodeURIComponent(baseBranch)}&limit=1&stat=false&verification=false&files=false`
      );
      return Array.isArray(rows)
        ? { merged: rows.length === 0, date: null }
        : null;
    },
    async changedFiles(b, head) {
      // Gitea 1.22+ and Forgejo 7+.
      const c = await get<{ files?: Array<{ filename: string }> }>(
        `/compare/${encodeURIComponent(b)}...${encodeURIComponent(head)}`
      );
      return c?.files ? c.files.map((f) => f.filename) : null;
    },
    async mergedPrs() {
      const out = new Map<string, MergedPr>();
      const rows = await get<Pr[]>(
        `/pulls?state=closed&limit=50&sort=recentupdate`
      );
      for (const p of rows ?? []) {
        const head = p.head?.ref;
        if (!head || !p.merged || out.has(head)) continue;
        out.set(head, {
          number: p.number,
          url: p.html_url,
          mergedAt: p.merged_at ?? null,
          headSha: p.head?.sha ?? null,
        });
      }
      return out;
    },
    async deleteBranch(name) {
      const res = await hostFetch(L, `${base}/branches/${encodePath(name)}`, {
        method: "DELETE",
        headers,
      });
      return res.status === 204 || res.ok
        ? { ok: true }
        : { ok: false, error: await errText(res) };
    },
    compareUrl: (b, head) =>
      `${ref.origin}/${encodePath(ref.path)}/compare/${encodeURI(b)}...${encodeURI(head)}`,
    cloneUrl: () => withAuth(ref.origin, ref.path, "oauth2", token),
  };
}

export async function giteaRepos(
  origin: string,
  creds: Credentials
): Promise<HostRepo[]> {
  const out: HostRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await hostFetch(
      L,
      `${origin}/api/v1/user/repos?limit=50&page=${page}`,
      {
        headers: headersFor(creds.token),
        timeoutMs: 20_000,
      }
    );
    if (!res.ok) throw new Error(await errText(res));
    const rows = (await res.json()) as Array<{
      full_name: string;
      html_url: string;
      default_branch?: string;
      private?: boolean;
      archived?: boolean;
      updated_at?: string | null;
      description?: string | null;
      language?: string | null;
    }>;
    for (const r of rows)
      if (!r.archived)
        out.push({
          fullName: r.full_name,
          url: r.html_url,
          defaultBranch: r.default_branch || "main",
          private: !!r.private,
          pushedAt: r.updated_at ?? null,
          description: r.description || null,
          language: r.language || null,
        });
    if (rows.length < 50) break;
  }
  return out.sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
}

export async function giteaWhoami(
  origin: string,
  creds: Credentials
): Promise<string> {
  const res = await hostFetch(L, `${origin}/api/v1/user`, {
    headers: headersFor(creds.token),
    timeoutMs: 15_000,
  });
  if (!res.ok) throw new Error(await errText(res));
  return ((await res.json()) as { login: string }).login;
}
