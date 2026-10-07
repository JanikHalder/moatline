import { eq } from "drizzle-orm";
import { db, orgIntegrations } from "db";
import { decryptSecret, isEncrypted } from "./crypto";
import { getGithubToken } from "./github-token";
import {
  HOST_LABEL,
  type ChecksResult,
  type Credentials,
  type GitApi,
  type GitHostKind,
  type HostRepo,
  type RepoRef,
} from "./git-api";
import { githubApi } from "./git-github";
import { gitlabApi, gitlabRepos, gitlabWhoami } from "./git-gitlab";
import { giteaApi, giteaRepos, giteaWhoami } from "./git-gitea";
import { bitbucketApi, bitbucketRepos, bitbucketWhoami } from "./git-bitbucket";

export * from "./git-api";

/**
 * Where a repository lives and how to talk to it. github.com, gitlab.com,
 * bitbucket.org and codeberg.org are known by name; self-hosted GitLab,
 * Gitea and Forgejo are known once an organization adds them under
 * Settings — their URL is what tells a host apart.
 */

export type HostEntry = {
  id: string;
  kind: Exclude<GitHostKind, "github">;
  /** Base URL: https://git.example.com (or with a path prefix). */
  url: string;
  username: string | null;
  token: string | null;
};

const KNOWN: Record<string, GitHostKind> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
  "codeberg.org": "gitea",
};

/** Base URL without a trailing slash, lowercased host. */
export function normalizeBase(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Where the branch starts in a browser URL, per host. */
const TREE: Record<GitHostKind, string[]> = {
  github: ["tree"],
  gitlab: ["-", "tree"],
  gitea: ["src", "branch"],
  bitbucket: ["src"],
};

/**
 * A repository from a URL the way people paste them: https or git@ SSH,
 * with or without .git, or a browser URL pointing at a branch.
 */
export function parseRepoUrl(
  input: string,
  hosts: Array<Pick<HostEntry, "kind" | "url">> = []
): RepoRef | null {
  let raw = input.trim();
  const ssh = raw.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  if (ssh) raw = `https://${ssh[1]}/${ssh[2]}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const here = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
  // A configured host first — a self-hosted GitLab may sit under a path.
  let origin: string | null = null;
  let kind: GitHostKind | null = null;
  for (const h of hosts) {
    const b = normalizeBase(h.url);
    if (b && (here === b || here.startsWith(`${b}/`))) {
      if (!origin || b.length > origin.length) {
        origin = b;
        kind = h.kind;
      }
    }
  }
  if (!origin) {
    if (u.protocol !== "https:") return null;
    kind = KNOWN[u.hostname.toLowerCase()] ?? null;
    if (!kind) return null;
    origin = `https://${u.hostname.toLowerCase()}`;
  }
  let rest: string[];
  try {
    rest = here
      .slice(origin.length)
      .split("/")
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  const marker = TREE[kind!];
  let end = rest.length;
  let branch = "main";
  for (let i = 0; i + marker.length <= rest.length; i++) {
    if (marker.every((m, j) => rest[i + j] === m)) {
      end = i;
      const b = rest.slice(i + marker.length).join("/");
      if (b) branch = b;
      break;
    }
  }
  // GitLab puts its pages behind "/-/": the project path ends there.
  if (kind === "gitlab") {
    const dash = rest.indexOf("-");
    if (dash !== -1 && dash < end) end = dash;
  }
  const segs = rest.slice(0, end);
  if (segs.length)
    segs[segs.length - 1] = segs[segs.length - 1]!.replace(/\.git$/, "");
  if (kind === "gitlab" ? segs.length < 2 : segs.length !== 2) return null;
  if (segs.some((s) => !s || s === "." || s === ".." || /[\s?#]/.test(s)))
    return null;
  const repo = segs[segs.length - 1]!;
  const owner = segs.slice(0, -1).join("/");
  return { kind: kind!, origin, owner, repo, path: `${owner}/${repo}`, branch };
}

/** The repository's page in a browser. */
export const webUrl = (r: RepoRef) => `${r.origin}/${r.path}`;

/** Same repository, however its URL was written. */
export function repoKey(url: string, hosts: HostEntry[] = []): string | null {
  const r = parseRepoUrl(url, hosts);
  return r ? `${r.origin}/${r.path}`.toLowerCase() : null;
}

function decrypt(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    return isEncrypted(v) ? decryptSecret(v) : v;
  } catch {
    return null;
  }
}

/** The organization's own hosts, tokens decrypted. */
export async function loadGitHosts(
  organizationId: string | null | undefined
): Promise<HostEntry[]> {
  if (!organizationId) return [];
  const [row] = await db
    .select({ gitHosts: orgIntegrations.gitHosts })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId))
    .limit(1)
    .catch(() => []);
  return (row?.gitHosts ?? []).map((h) => ({
    ...h,
    token: decrypt(h.token),
  }));
}

function apiFor(ref: RepoRef, creds: Credentials): GitApi {
  switch (ref.kind) {
    case "github":
      return githubApi(ref, creds);
    case "gitlab":
      return gitlabApi(ref, creds);
    case "gitea":
      return giteaApi(ref, creds);
    case "bitbucket":
      return bitbucketApi(ref, creds);
  }
}

export type RepoHandle = RepoRef & {
  /** "GitHub", "GitLab", … for messages. */
  label: string;
  token: string | null;
  api: GitApi;
};

/** Find the host entry that holds the credentials for a repository. */
function entryFor(ref: RepoRef, hosts: HostEntry[]): HostEntry | undefined {
  return hosts
    .filter((h) => h.kind === ref.kind && normalizeBase(h.url) === ref.origin)
    .at(0);
}

/**
 * A repository URL turned into something to talk to: parsed, with the
 * organization's credentials for its host. null when the URL is not a
 * repository on a known or configured host.
 */
export async function resolveRepo(
  url: string,
  organizationId: string | null | undefined
): Promise<RepoHandle | null> {
  const plain = parseRepoUrl(url);
  // GitHub needs no lookup of the organization's hosts.
  if (plain?.kind === "github") {
    const token = await getGithubToken(organizationId, plain.owner);
    return {
      ...plain,
      label: HOST_LABEL.github,
      token,
      api: githubApi(plain, { token, username: null }),
    };
  }
  const hosts = await loadGitHosts(organizationId);
  const ref = parseRepoUrl(url, hosts);
  if (!ref) return null;
  const entry = entryFor(ref, hosts);
  const creds = {
    token: entry?.token ?? null,
    username: entry?.username ?? null,
  };
  return {
    ...ref,
    label: HOST_LABEL[ref.kind],
    token: creds.token,
    api: apiFor(ref, creds),
  };
}

/** A token in a message must never reach a log or the UI. */
export function redact(text: string, token: string | null): string {
  return token ? text.split(token).join("***") : text;
}

/**
 * Poll until CI stops being pending. Returns the last state either way — a
 * timeout is reported as still pending rather than quietly passing.
 */
export async function waitForHostChecks(
  api: GitApi,
  ref: string,
  opts?: { timeoutMs?: number; intervalMs?: number; now?: () => number }
): Promise<ChecksResult> {
  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
  const intervalMs = opts?.intervalMs ?? 20_000;
  const now = opts?.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let last = await api.checks(ref);
  while (last.state === "pending" && now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await api.checks(ref);
  }
  return last;
}

/** Repositories a host's credentials can read, for the picker. */
export async function listHostRepos(h: HostEntry): Promise<HostRepo[]> {
  const creds = { token: h.token, username: h.username };
  const base = normalizeBase(h.url)!;
  switch (h.kind) {
    case "gitlab":
      return gitlabRepos(base, creds);
    case "gitea":
      return giteaRepos(base, creds);
    case "bitbucket":
      return bitbucketRepos(creds);
  }
}

/** Who the credentials belong to — proof that they work. */
export async function whoami(
  h: Pick<HostEntry, "kind" | "url" | "username" | "token">
): Promise<string> {
  const creds = { token: h.token, username: h.username };
  const base = normalizeBase(h.url)!;
  switch (h.kind) {
    case "gitlab":
      return gitlabWhoami(base, creds);
    case "gitea":
      return giteaWhoami(base, creds);
    case "bitbucket":
      return bitbucketWhoami(creds);
  }
}
