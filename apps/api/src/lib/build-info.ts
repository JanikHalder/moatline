import { execFileSync } from "node:child_process";

/**
 * Which build is running here. `/api/health` reports it so that "is the fix
 * deployed?" has an answer that does not depend on clicking through the UI and
 * guessing from behaviour — for this instance, and for every other deployment
 * that is watched through a repository's live URL.
 *
 * Platforms name the commit differently, so the usual suspects are all read.
 * Setting one of them (GIT_COMMIT_SHA is the plainest) is the reliable route;
 * asking git is a fallback for deployments that keep the checkout around.
 */
const COMMIT_ENV_VARS = [
  "GIT_COMMIT_SHA",
  "GIT_SHA",
  "COMMIT_SHA",
  "SOURCE_COMMIT",
  "RAILWAY_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

let cached: { commit: string | null } | null = null;

function readCommit(): string | null {
  for (const name of COMMIT_ENV_VARS) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // No git, no checkout, or a build that dropped .git – simply unknown.
    return null;
  }
}

/** Resolved once: neither the env nor the checkout changes while we run. */
export function buildCommit(): string | null {
  cached ??= { commit: readCommit() };
  return cached.commit;
}

export const startedAt = new Date().toISOString();
