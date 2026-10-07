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

/**
 * Bitbucket Cloud, API 2.0. Two kinds of credentials: an API token (or an
 * old app password) with the account's email or username — Basic auth — or
 * a repository/project/workspace access token on its own — Bearer.
 */

const API = "https://api.bitbucket.org/2.0";
const L = "Bitbucket";

type Pr = {
  id: number;
  title: string;
  state: string;
  draft?: boolean;
  created_on: string;
  updated_on?: string;
  author?: { display_name?: string; nickname?: string } | null;
  source?: { branch?: { name?: string }; commit?: { hash?: string } };
  merge_commit?: { hash?: string } | null;
  links?: { html?: { href?: string } };
};

type Page<T> = { values?: T[]; next?: string };

function headersFor(creds: Credentials): Record<string, string> {
  const auth: Record<string, string> = !creds.token
    ? {}
    : creds.username
      ? {
          Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.token}`).toString("base64")}`,
        }
      : { Authorization: `Bearer ${creds.token}` };
  return { Accept: "application/json", ...auth };
}

const errText = async (res: Response) =>
  `Bitbucket ${res.status}: ${(await res.text()).slice(0, 200)}`;

/** Which user name git takes with each kind of credential. */
function gitUser(creds: Credentials): string {
  if (!creds.username) return "x-token-auth";
  return creds.username.includes("@")
    ? "x-bitbucket-api-token-auth"
    : creds.username;
}

export function bitbucketApi(ref: RepoRef, creds: Credentials): GitApi {
  const base = `${API}/repositories/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const headers = headersFor(creds);
  const json = { ...headers, "Content-Type": "application/json" };
  const get = <T>(path: string) => getJson<T>(L, `${base}${path}`, headers);
  const branch = (name: string) =>
    get<{ target?: { hash?: string } }>(`/refs/branches/${encodePath(name)}`);
  const sha = async (at: string) =>
    isSha(at) ? at : ((await branch(at))?.target?.hash ?? null);
  const prUrl = (p: Pr) =>
    p.links?.html?.href ??
    `https://bitbucket.org/${ref.path}/pull-requests/${p.id}`;
  const findOpen = async (head: string) => {
    const q = encodeURIComponent(
      `source.branch.name="${head.replace(/"/g, "")}" AND state="OPEN"`
    );
    const page = await get<Page<Pr>>(`/pullrequests?q=${q}`);
    return page?.values?.[0] ?? null;
  };

  return {
    kind: "bitbucket",
    async readFile(filePath, at) {
      const res = await fetch(
        `${base}/src/${encodeURIComponent(at)}/${encodePath(filePath)}`,
        { headers, signal: AbortSignal.timeout(30_000) }
      ).catch(() => null);
      if (!res)
        return { ok: false, status: 0, error: "Bitbucket did not answer" };
      return res.ok
        ? { ok: true, text: await res.text() }
        : {
            ok: false,
            status: res.status,
            error: (await res.text()).slice(0, 200) || res.statusText,
          };
    },
    async branchHead(name) {
      const h = (await branch(name))?.target?.hash;
      return h && /^[0-9a-f]{40}$/i.test(h) ? h.toLowerCase() : null;
    },
    async commitAt(name, at) {
      const page = await get<Page<{ hash: string; date?: string }>>(
        `/commits/${encodeURIComponent(name)}?pagelen=50`
      );
      const limit = Date.parse(at);
      return (
        page?.values?.find((c) => Date.parse(c.date ?? "") <= limit)?.hash ??
        null
      );
    },
    async listOpenPrs() {
      const page = await get<Page<Pr>>(`/pullrequests?state=OPEN&pagelen=50`);
      return (
        page?.values?.map((p) => ({
          number: p.id,
          title: p.title,
          url: prUrl(p),
          author: p.author?.nickname ?? p.author?.display_name ?? null,
          draft: !!p.draft,
          createdAt: p.created_on,
          headRef: p.source?.branch?.name ?? "",
          headSha: p.source?.commit?.hash ?? null,
        })) ?? null
      );
    },
    async getPr(number) {
      const p = await get<Pr>(`/pullrequests/${number}`);
      if (!p) return null;
      return {
        state:
          p.state === "MERGED"
            ? "merged"
            : p.state === "OPEN"
              ? "open"
              : "closed",
        mergeSha: p.merge_commit?.hash ?? null,
      };
    },
    async createPr(opts) {
      try {
        const res = await hostFetch(L, `${base}/pullrequests`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            title: opts.title,
            description: opts.body,
            source: { branch: { name: opts.head } },
            destination: { branch: { name: opts.base } },
            close_source_branch: false,
          }),
        });
        if (res.status === 201 || res.status === 200) {
          const p = (await res.json()) as Pr;
          return { ok: true, number: p.id, url: prUrl(p) };
        }
        const text = await errText(res);
        if (/no changes/i.test(text))
          return {
            ok: false,
            error: "No changes to open a PR for.",
            noDiff: true,
          };
        const existing = await findOpen(opts.head);
        if (existing)
          return {
            ok: true,
            number: existing.id,
            url: prUrl(existing),
            alreadyExists: true,
          };
        return { ok: false, error: text };
      } catch (e) {
        const existing = await findOpen(opts.head).catch(() => null);
        if (existing)
          return {
            ok: true,
            number: existing.id,
            url: prUrl(existing),
            alreadyExists: true,
          };
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Bitbucket did not answer",
        };
      }
    },
    async mergePr(number) {
      const res = await hostFetch(L, `${base}/pullrequests/${number}/merge`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          merge_strategy: "squash",
          close_source_branch: false,
        }),
      });
      if (res.status === 200) {
        const p = (await res.json()) as Pr;
        return { ok: true, sha: p.merge_commit?.hash ?? undefined };
      }
      // Long merges finish in the background.
      if (res.status === 202) return { ok: true };
      const text = await errText(res);
      if (res.status === 400 || res.status === 409)
        return {
          ok: false,
          error: `Not mergeable – merge checks or conflicts: ${text}`,
          notMergeable: true,
        };
      return { ok: false, error: text };
    },
    async checks(at) {
      const commit = await sha(at);
      if (!commit) return { state: "none", detail: "commit not found" };
      const page = await get<
        Page<{ name?: string; key?: string; state?: string }>
      >(`/commit/${commit}/statuses?pagelen=100`);
      if (!page) return { state: "none", detail: "CI status not readable" };
      return foldChecks(
        (page.values ?? []).map((s) => ({
          name: s.name ?? s.key ?? "build",
          state:
            s.state === "SUCCESSFUL"
              ? "success"
              : s.state === "FAILED" || s.state === "STOPPED"
                ? "failure"
                : "pending",
        }))
      );
    },
    async revertTip(name, commit) {
      return {
        ok: false,
        error: `Bitbucket cannot revert a commit through its API — revert ${commit.slice(0, 7)} on ${name} by hand.`,
      };
    },
    async listBranches() {
      const out: HostBranch[] = [];
      let url: string | undefined =
        `${base}/refs/branches?pagelen=100&sort=-target.date`;
      for (let i = 0; url && i < 3; i++) {
        const page: Page<{
          name: string;
          target: { hash: string; date?: string };
        }> | null = await getJson(L, url, headers);
        if (!page) {
          if (i === 0) throw new Error("Bitbucket did not list the branches");
          break;
        }
        for (const b of page.values ?? [])
          out.push({
            name: b.name,
            sha: b.target.hash,
            date: b.target.date ?? null,
            protected: false,
          });
        url = page.next;
      }
      return out;
    },
    async compareBranch(head, baseBranch) {
      const page = await get<Page<unknown>>(
        `/commits/${encodeURIComponent(head)}?exclude=${encodeURIComponent(baseBranch)}&pagelen=1`
      );
      return Array.isArray(page?.values)
        ? { merged: page.values.length === 0, date: null }
        : null;
    },
    async changedFiles(b, head) {
      // Bitbucket's spec reads "head..base".
      const page = await get<
        Page<{ new?: { path?: string } | null; old?: { path?: string } | null }>
      >(
        `/diffstat/${encodeURIComponent(head)}..${encodeURIComponent(b)}?pagelen=500`
      );
      return page?.values
        ? page.values.flatMap((v) => {
            const p = v.new?.path ?? v.old?.path;
            return p ? [p] : [];
          })
        : null;
    },
    async mergedPrs() {
      const out = new Map<string, MergedPr>();
      const page = await get<Page<Pr>>(
        `/pullrequests?state=MERGED&pagelen=50&sort=-updated_on`
      );
      for (const p of page?.values ?? []) {
        const head = p.source?.branch?.name;
        if (!head || out.has(head)) continue;
        out.set(head, {
          number: p.id,
          url: prUrl(p),
          mergedAt: p.updated_on ?? null,
          headSha: p.source?.commit?.hash ?? null,
        });
      }
      return out;
    },
    async deleteBranch(name) {
      const res = await hostFetch(
        L,
        `${base}/refs/branches/${encodePath(name)}`,
        {
          method: "DELETE",
          headers,
        }
      );
      return res.status === 204 || res.ok
        ? { ok: true }
        : { ok: false, error: await errText(res) };
    },
    compareUrl: (b, head) =>
      `https://bitbucket.org/${ref.path}/pull-requests/new?source=${encodeURIComponent(head)}&dest=${encodeURIComponent(b)}`,
    cloneUrl: () => withAuth(ref.origin, ref.path, gitUser(creds), creds.token),
  };
}

export async function bitbucketRepos(creds: Credentials): Promise<HostRepo[]> {
  const out: HostRepo[] = [];
  let url: string | undefined =
    `${API}/repositories?role=member&pagelen=100&sort=-updated_on`;
  for (let i = 0; url && i < 5; i++) {
    const res = await hostFetch(L, url, {
      headers: headersFor(creds),
      timeoutMs: 20_000,
    });
    if (!res.ok) throw new Error(await errText(res));
    const page = (await res.json()) as Page<{
      full_name: string;
      links?: { html?: { href?: string } };
      mainbranch?: { name?: string } | null;
      is_private?: boolean;
      updated_on?: string | null;
      description?: string | null;
      language?: string | null;
    }>;
    for (const r of page.values ?? [])
      out.push({
        fullName: r.full_name,
        url: r.links?.html?.href ?? `https://bitbucket.org/${r.full_name}`,
        defaultBranch: r.mainbranch?.name ?? "main",
        private: !!r.is_private,
        pushedAt: r.updated_on ?? null,
        description: r.description || null,
        language: r.language || null,
      });
    url = page.next;
  }
  return out;
}

export async function bitbucketWhoami(creds: Credentials): Promise<string> {
  // An access token belongs to a repository or workspace, not to a user:
  // the first repository it opens is the test.
  if (!creds.username) return "access token";
  const res = await hostFetch(L, `${API}/user`, {
    headers: headersFor(creds),
    timeoutMs: 15_000,
  });
  if (!res.ok) throw new Error(await errText(res));
  const u = (await res.json()) as { username?: string; display_name?: string };
  return u.username ?? u.display_name ?? "connected";
}
