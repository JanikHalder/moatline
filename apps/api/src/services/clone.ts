import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { run } from "../lib/run";
import type { RunResult } from "../lib/run";

const CLONE_TIMEOUT_MS = 120_000;

export type CloneResult = {
  ok: boolean;
  /** Always returned when a temp dir was created, so the caller can clean up. */
  tempDir: string | null;
  /** Directory that contains the package.json (repo root or a subdir). */
  projectDir: string;
  error?: string;
};

/** A 7–40 character hex SHA. Anything else is not fetched at all. */
export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

/**
 * Fetch one commit into an empty repo, rather than cloning a branch. `git
 * clone --branch` only accepts branch and tag names, and the deployed commit
 * is usually neither — it sits somewhere behind the branch tip.
 */
async function cloneAtCommit(
  cloneUrl: string,
  commit: string,
  tempDir: string
): Promise<RunResult> {
  // The SHA becomes an argv element for git. It never reaches a shell, but a
  // value starting with "-" would still be read as an option.
  if (!isCommitSha(commit)) {
    return {
      ok: false,
      stdout: "",
      stderr: `"${commit}" is not a commit SHA.`,
      status: null,
      timedOut: false,
    };
  }
  const steps: string[][] = [
    ["init", "--quiet"],
    ["remote", "add", "origin", cloneUrl],
    ["fetch", "--depth", "1", "--quiet", "origin", commit],
    ["checkout", "--quiet", "FETCH_HEAD"],
  ];
  let last: RunResult | null = null;
  for (const args of steps) {
    last = await run("git", args, {
      cwd: tempDir,
      timeout: CLONE_TIMEOUT_MS,
    });
    if (!last.ok) return last;
  }
  return last!;
}

/** Resolve the project dir (that holds package.json) inside a clone. */
export function projectDirFromPackageJsonPath(
  tempDir: string,
  packageJsonPath: string
): string {
  const dir = path.dirname(packageJsonPath || "package.json");
  return dir === "." || dir === "" ? tempDir : path.join(tempDir, dir);
}

/**
 * Shallow-clone a repo into a fresh temp dir. Centralizes the auth URL,
 * timeout, git-missing detection and dir layout.
 * The caller owns cleanup via {@link cleanupClone} (temp dir is returned even
 * on failure so it can still be removed).
 */
export async function cloneRepo(opts: {
  owner: string;
  repo: string;
  /**
   * Clone URL with credentials in it — any host (GitLab, Gitea, Bitbucket).
   * Without it, github.com/owner/repo with the token.
   */
  url?: string;
  branch: string;
  /**
   * Exact commit to check out instead of the branch tip — used to inspect the
   * version that is actually deployed, which is usually behind the branch.
   * Fetched by SHA (GitHub allows it), so history stays shallow.
   */
  commit?: string | null;
  packageJsonPath?: string;
  token?: string | null;
  prefix?: string;
}): Promise<CloneResult> {
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? null;
  const cloneUrl =
    opts.url ??
    (token
      ? `https://x-access-token:${token}@github.com/${opts.owner}/${opts.repo}.git`
      : `https://github.com/${opts.owner}/${opts.repo}.git`);

  let tempDir: string;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), opts.prefix ?? "clone-"));
  } catch (e) {
    return {
      ok: false,
      tempDir: null,
      projectDir: "",
      error: e instanceof Error ? e.message : "mkdtemp failed",
    };
  }

  const clone = opts.commit
    ? await cloneAtCommit(cloneUrl, opts.commit, tempDir)
    : await run(
        "git",
        ["clone", "--depth", "1", "--branch", opts.branch, cloneUrl, tempDir],
        { cwd: os.tmpdir(), timeout: CLONE_TIMEOUT_MS }
      );
  const projectDir = projectDirFromPackageJsonPath(
    tempDir,
    opts.packageJsonPath ?? "package.json"
  );
  if (!clone.ok) {
    const err = [clone.stdout, clone.stderr]
      .filter(Boolean)
      .join("\n")
      .slice(0, 500);
    // Never echo the token if it somehow appears in git output.
    const safe = token ? err.split(token).join("***") : err;
    const error = safe.includes("git not found on PATH")
      ? "git is not installed on the server – git clone unavailable."
      : `Clone failed: ${safe || "unknown"}`;
    return { ok: false, tempDir, projectDir, error };
  }
  return { ok: true, tempDir, projectDir };
}

export function cleanupClone(tempDir: string | null): void {
  if (tempDir && fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
