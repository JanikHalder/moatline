import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, repositories, updateRuns } from "db";
import { findLockfile } from "../lib/fix-strategy";
import { resolveRepo } from "../lib/git-host";
import { alignLockedFamilies } from "../lib/lockfile-fix";
import { run } from "../lib/run";
import { cleanupClone, cloneRepo } from "./clone";

/** Marker in the run log: the mismatch reported above it is repaired. */
export const VERSIONS_FIXED = "[versions fixed]";

export type AlignOutcome =
  | { ok: true; pinned: Record<string, string>; pushed: boolean }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string };

/**
 * Repair the package versions on an open run's branch: pin every package
 * released with Payload / Next.js / React / Lexical to its leader's version,
 * re-resolve the lockfile (no install) and push to the same branch — the
 * pull request updates itself.
 */
export async function alignRunBranch(
  runId: string,
  organizationId: string
): Promise<AlignOutcome> {
  const [row] = await db
    .select({ run: updateRuns, repo: repositories })
    .from(updateRuns)
    .innerJoin(repositories, eq(updateRuns.repositoryId, repositories.id))
    .where(eq(updateRuns.id, runId));
  if (!row || row.repo.organizationId !== organizationId)
    return { ok: false, status: 404, error: "Run not found" };
  const { run: updateRun, repo } = row;
  if (updateRun.merged)
    return { ok: false, status: 409, error: "Already merged." };
  const parsed = await resolveRepo(repo.githubUrl, organizationId);
  const token = parsed?.token ?? null;
  if (!parsed || !token)
    return {
      ok: false,
      status: 400,
      error: "No token for the repository's Git host.",
    };

  const cloned = await cloneRepo({
    owner: parsed.owner,
    repo: parsed.repo,
    url: parsed.api.cloneUrl(),
    branch: updateRun.branchName,
    packageJsonPath: repo.packageJsonPath || "package.json",
    token,
    prefix: "align-",
  });
  try {
    if (!cloned.ok || !cloned.tempDir)
      return { ok: false, status: 502, error: cloned.error ?? "Clone failed" };
    const tempDir = cloned.tempDir;
    const lock = findLockfile(cloned.projectDir, tempDir);
    if (!lock)
      return { ok: false, status: 400, error: "The branch has no lockfile." };
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cloned.projectDir, "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({
      ...pkg.devDependencies,
      ...pkg.dependencies,
    });
    const aligned = await alignLockedFamilies(
      lock.dir,
      lock.manager,
      declared,
      (cmd, args) =>
        run(cmd, args, {
          cwd: lock.dir,
          timeout: 300_000,
          scrubSecrets: true,
          env: { YARN_ENABLE_IMMUTABLE_INSTALLS: "false" },
        })
    );
    if (!aligned.ok)
      return {
        ok: false,
        status: 502,
        error: `Re-resolving the lockfile failed: ${aligned.output.slice(0, 300)}`,
      };
    const names = Object.keys(aligned.pinned);
    let pushed = false;
    if (names.length) {
      await run("git", ["config", "user.email", "moatline@local"], {
        cwd: tempDir,
      });
      await run("git", ["config", "user.name", "Moatline"], {
        cwd: tempDir,
      });
      await run("git", ["add", "-A", path.relative(tempDir, lock.dir) || "."], {
        cwd: tempDir,
      });
      const commit = await run(
        "git",
        [
          "commit",
          "-m",
          `fix(deps): one version for packages released together\n\n${names
            .map((n) => `${n} → ${aligned.pinned[n]}`)
            .join("\n")}`,
        ],
        { cwd: tempDir }
      );
      if (!commit.ok)
        return {
          ok: false,
          status: 502,
          error: `git commit failed: ${commit.stderr}`,
        };
      const push = await run("git", ["push", "origin", updateRun.branchName], {
        cwd: tempDir,
        timeout: 60_000,
        env: { GIT_TERMINAL_PROMPT: "0" },
      });
      if (!push.ok)
        return {
          ok: false,
          status: 502,
          error: `git push failed: ${push.stderr}`,
        };
      pushed = true;
    }
    await db
      .update(updateRuns)
      .set({
        logOutput: `${updateRun.logOutput ?? ""}\n\n${VERSIONS_FIXED}\n${
          names.length
            ? names.map((n) => `${n} → ${aligned.pinned[n]}`).join("\n")
            : "everything already matched"
        }`,
      })
      .where(eq(updateRuns.id, runId));
    return { ok: true, pinned: aligned.pinned, pushed };
  } finally {
    cleanupClone(cloned.tempDir);
  }
}
