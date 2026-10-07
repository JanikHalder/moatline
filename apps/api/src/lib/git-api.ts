/**
 * What Moatline asks of a Git host — GitHub, GitLab, Gitea/Forgejo or
 * Bitbucket. Each host answers in its own API; the adapters translate, so
 * scans, fix runs and the branch overview do not care where a repository
 * lives.
 */

export type GitHostKind = "github" | "gitlab" | "gitea" | "bitbucket";

export const HOST_LABEL: Record<GitHostKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};

/** A repository on a host, as read from its URL. */
export type RepoRef = {
  kind: GitHostKind;
  /** https://github.com, https://gitlab.example.com */
  origin: string;
  /** User, organization, workspace or GitLab group path (may contain "/"). */
  owner: string;
  repo: string;
  /** owner/repo — the path after the host. */
  path: string;
  /** Branch from a …/tree/<branch> URL, else "main". */
  branch: string;
};

export type Credentials = {
  token: string | null;
  /** Bitbucket API tokens and app passwords authenticate as a user. */
  username: string | null;
};

export type CreatePrResult =
  | { ok: true; number: number; url: string; alreadyExists?: boolean }
  | { ok: false; error: string; noDiff?: boolean };

export type MergePrResult =
  | { ok: true; sha?: string }
  | { ok: false; error: string; notMergeable?: boolean };

export type ChecksState = "success" | "pending" | "failure" | "none";

export type ChecksResult = {
  state: ChecksState;
  /** One line naming what is pending or what failed. */
  detail: string;
};

export type RevertResult =
  | { ok: true; sha: string }
  | { ok: false; error: string; moved?: boolean };

export type ReadResult =
  | { ok: true; text: string }
  | { ok: false; status: number; error: string };

export type HostPr = {
  number: number;
  title: string;
  url: string;
  author: string | null;
  draft: boolean;
  createdAt: string;
  headRef: string;
  /** Tip of the PR's branch, when the host says. */
  headSha: string | null;
};

export type PrState = {
  state: "open" | "merged" | "closed";
  mergeSha: string | null;
};

export type HostBranch = {
  name: string;
  sha: string;
  /** Date of the newest commit, when the host lists it with the branch. */
  date: string | null;
  protected: boolean;
  /** GitLab says itself whether a branch is merged into the default one. */
  merged?: boolean;
};

/** A pull request that was merged, by the branch it came from. */
export type MergedPr = {
  number: number;
  url: string;
  mergedAt: string | null;
  /** Tip of the branch when it was merged (Bitbucket: abbreviated). */
  headSha: string | null;
};

export type Ok = { ok: true } | { ok: false; error: string };

export type HostRepo = {
  fullName: string;
  url: string;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  description: string | null;
  language: string | null;
};

export interface GitApi {
  readonly kind: GitHostKind;
  readFile(filePath: string, ref: string): Promise<ReadResult>;
  /** SHA of a branch tip, lowercased. */
  branchHead(branch: string): Promise<string | null>;
  /** The newest commit on a branch at a moment. */
  commitAt(branch: string, at: string): Promise<string | null>;
  listOpenPrs(): Promise<HostPr[] | null>;
  getPr(number: number): Promise<PrState | null>;
  createPr(opts: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<CreatePrResult>;
  mergePr(number: number, opts?: { sha?: string }): Promise<MergePrResult>;
  checks(ref: string): Promise<ChecksResult>;
  /** Undo the tip commit of a branch — only while it is still the tip. */
  revertTip(
    branch: string,
    sha: string,
    message: string
  ): Promise<RevertResult>;
  listBranches(): Promise<HostBranch[]>;
  /**
   * Whether every commit of `head` is already in `base`, and the date of
   * head's newest commit when the answer brings it. null when the host
   * could not say.
   */
  compareBranch(
    head: string,
    base: string
  ): Promise<{ merged: boolean; date: string | null } | null>;
  /**
   * Paths changed between two refs (base...head), up to a few hundred.
   * null when the host could not say.
   */
  changedFiles(base: string, head: string): Promise<string[] | null>;
  /** Recently merged pull requests by source branch (catches squash merges). */
  mergedPrs(): Promise<Map<string, MergedPr>>;
  deleteBranch(name: string): Promise<Ok>;
  /** Where a person opens a PR for a pushed branch. */
  compareUrl(base: string, head: string): string;
  /** git clone/push URL, with the token in it when there is one. */
  cloneUrl(): string;
}

export class HostError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Every host call with a deadline and one retry for timeouts and 5xx — a
 * stalled connection must end in an error, not leave a fix run waiting.
 * Retrying a PR creation is safe: the second one finds the first.
 */
export async function hostFetch(
  label: string,
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(init?.timeoutMs ?? 60_000),
      });
      if (res.status >= 502 && res.status <= 504 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt > 0) {
        throw new Error(
          `${label} did not answer (${e instanceof Error ? e.message : "network error"})`
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** JSON of a GET, or null on any failure. */
export async function getJson<T>(
  label: string,
  url: string,
  headers: Record<string, string>
): Promise<T | null> {
  try {
    const res = await hostFetch(label, url, { headers, timeoutMs: 20_000 });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const isSha = (v: string) => /^[0-9a-f]{7,40}$/i.test(v);

/** Path segments encoded one by one: "a/b c.json" → "a/b%20c.json". */
export const encodePath = (p: string) =>
  p.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

/** A token in a URL, for git: "user:token@". */
export function withAuth(
  origin: string,
  path: string,
  user: string | null,
  token: string | null
): string {
  const u = new URL(`${origin}/${path}.git`);
  if (token) {
    u.username = encodeURIComponent(user ?? "oauth2");
    u.password = encodeURIComponent(token);
  }
  return u.toString();
}

/** Folds a list of CI results into one state, the same way for every host. */
export function foldChecks(
  items: Array<{ name: string; state: "success" | "pending" | "failure" }>
): ChecksResult {
  const failing = items.filter((i) => i.state === "failure");
  if (failing.length)
    return {
      state: "failure",
      detail: `failing: ${failing.map((i) => i.name).join(", ")}`,
    };
  const pending = items.filter((i) => i.state === "pending");
  if (pending.length)
    return {
      state: "pending",
      detail: `running: ${pending.map((i) => i.name).join(", ")}`,
    };
  if (!items.length)
    return { state: "none", detail: "no CI reported on this commit" };
  return { state: "success", detail: `${items.length} check(s) passed` };
}
