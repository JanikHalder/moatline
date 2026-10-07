import type { GitHostKind } from "@/lib/api";

/** Repository URLs on any Git host: links, labels and short names. */

export const HOST_LABEL: Record<GitHostKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};

const KNOWN: Record<string, GitHostKind> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
  "codeberg.org": "gitea",
};

/** The URL without .git, trailing slashes and a git@ prefix. */
export function cleanRepoUrl(url: string): string {
  const t = url
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const ssh = t.match(/^git@([^:]+):(.+)$/);
  return ssh ? `https://${ssh[1]}/${ssh[2]}` : t;
}

/** Looks like a repository: https://host/owner/repo (or deeper, GitLab). */
export function looksLikeRepoUrl(url: string): boolean {
  try {
    const u = new URL(cleanRepoUrl(url));
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      u.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}

/** The host kind: the API's word when it has one, else by host name. */
export function hostKind(
  url: string,
  known?: GitHostKind | null
): GitHostKind | null {
  if (known) return known;
  try {
    return KNOWN[new URL(cleanRepoUrl(url)).hostname.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

export function hostLabel(url: string, known?: GitHostKind | null): string {
  const k = hostKind(url, known);
  return k ? HOST_LABEL[k] : "Git";
}

/** owner/repo — with the host in front when it is not GitHub. */
export function repoShortName(url: string): string {
  const clean = cleanRepoUrl(url);
  try {
    const u = new URL(clean);
    const path = u.pathname.replace(/^\/+/, "");
    return u.hostname === "github.com" ? path : `${u.hostname}/${path}`;
  } catch {
    return clean;
  }
}

/** The host's list of open pull (merge) requests. */
export function pullsUrl(url: string, known?: GitHostKind | null): string {
  const base = cleanRepoUrl(url);
  switch (hostKind(url, known)) {
    case "gitlab":
      return `${base}/-/merge_requests`;
    case "bitbucket":
      return `${base}/pull-requests`;
    default:
      return `${base}/pulls`;
  }
}

/** Where a person opens a pull request for a pushed branch. */
export function compareUrl(
  url: string,
  base: string,
  head: string,
  known?: GitHostKind | null
): string {
  const repo = cleanRepoUrl(url);
  switch (hostKind(url, known)) {
    case "gitlab":
      return `${repo}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(head)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`;
    case "bitbucket":
      return `${repo}/pull-requests/new?source=${encodeURIComponent(head)}&dest=${encodeURIComponent(base)}`;
    case "gitea":
      return `${repo}/compare/${encodeURI(base)}...${encodeURI(head)}`;
    default:
      return `${repo}/compare/${encodeURI(base)}...${encodeURI(head)}?expand=1`;
  }
}

/** A branch's page on the host. */
export function branchUrl(
  url: string,
  branch: string,
  known?: GitHostKind | null
): string {
  const repo = cleanRepoUrl(url);
  switch (hostKind(url, known)) {
    case "gitlab":
      return `${repo}/-/tree/${encodeURI(branch)}`;
    case "bitbucket":
      return `${repo}/branch/${encodeURI(branch)}`;
    case "gitea":
      return `${repo}/src/branch/${encodeURI(branch)}`;
    default:
      return `${repo}/tree/${encodeURI(branch)}`;
  }
}
