import fs from "node:fs";
import { effectiveVerifyMode } from "../lib/cloud";
import path from "node:path";
import { db, updateRuns, repositories } from "db";
import { eq } from "drizzle-orm";
import { resolveRepo } from "../lib/git-host";
import { notify } from "../lib/notify";
import { run, appendLog, buildMemoryMb } from "../lib/run";
import { runTypecheck } from "../lib/typecheck";
import {
  alignDeclared,
  checkInstalled,
  describeCheck,
  pinFamily,
  type Family,
} from "../lib/lockstep";
import { alignLockedFamilies } from "../lib/lockfile-fix";
import { startRunHeartbeat } from "./run-heartbeat";
import { failedWhile } from "../lib/run-phase";
import { availableMemoryMb, withHeavySlot } from "../lib/heavy-jobs";
import { cloneRepo, cleanupClone } from "./clone";
import {
  detectPackageManager,
  type PackageManager,
} from "../lib/package-manager";
import { emitEvent } from "../lib/events";

const NCU_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 300_000;
const BUILD_TIMEOUT_MS = 300_000;

/** Install / build invocations per package manager. */
const COMMANDS: Record<
  PackageManager,
  { install: [string, string[]]; build: [string, string[]] }
> = {
  npm: {
    install: ["npm", ["install", "--no-audit", "--no-fund"]],
    build: ["npm", ["run", "build"]],
  },
  pnpm: {
    install: ["pnpm", ["install", "--no-frozen-lockfile"]],
    build: ["pnpm", ["run", "build"]],
  },
  yarn: {
    install: ["yarn", ["install"]],
    build: ["yarn", ["run", "build"]],
  },
};

/** Lockfile each manager writes, so only the right one gets committed. */
const LOCKFILES: Record<PackageManager, string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
};

/**
 * A build needs room: below BUILD_MIN_FREE_MB (default the heap cap) it is
 * skipped instead of pushing the server into the OOM killer. The PR then
 * says so and is never auto-merged.
 */
function buildRoom(): { ok: true } | { ok: false; reason: string } {
  const need = Number(process.env.BUILD_MIN_FREE_MB) || buildMemoryMb();
  const free = Math.round(availableMemoryMb());
  return free >= need
    ? { ok: true }
    : {
        ok: false,
        reason: `[build]\nskipped: only ${free} MB memory free, a build needs ${need} MB (BUILD_MIN_FREE_MB). Not verified — no auto-merge.`,
      };
}

/** One update run at a time across the whole API — see withHeavySlot. */
/**
 * "minor": newest release within each package's major — what usually
 * deploys without code changes. "latest": every package to its newest
 * release, majors included.
 */
export type UpdateTarget = "minor" | "latest";

/** Bulk upgrade: one family (Payload, Next.js …) to one exact release. */
export type UpdatePin = { family: Family["name"]; version: string };

type UpdateOpts = { withAi?: boolean; target?: UpdateTarget; pin?: UpdatePin };

export function runUpdateWorkflow(
  runId: string,
  opts: UpdateOpts
): Promise<void> {
  const stop = startRunHeartbeat(runId);
  return withHeavySlot(
    () => runUpdateWorkflowNow(runId, opts),
    (ahead) =>
      db
        .update(updateRuns)
        .set({
          logOutput: `Waiting for ${ahead === 1 ? "another build" : `${ahead} other builds`} to finish — builds run one at a time so they cannot overload the server.`,
        })
        .where(eq(updateRuns.id, runId))
        .then(() => undefined)
  ).finally(stop);
}

async function runUpdateWorkflowNow(
  runId: string,
  opts: UpdateOpts
): Promise<void> {
  const [run_] = await db
    .select()
    .from(updateRuns)
    .where(eq(updateRuns.id, runId));
  if (!run_) return;
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, run_.repositoryId));
  if (!repo) return;

  const log: string[] = [];

  /**
   * Publish the current phase together with the log so far. A run spends
   * minutes inside "updating" — without this the UI has nothing to show until
   * the whole thing is over.
   */
  let phase: string | null = null;
  const setStep = async (
    step: string | null,
    extra: Partial<typeof updateRuns.$inferInsert> = {}
  ) => {
    if (step) phase = step;
    await db
      .update(updateRuns)
      .set({ currentStep: step, logOutput: log.join("\n\n"), ...extra })
      .where(eq(updateRuns.id, runId));
  };

  const fail = async (message: string) => {
    const fullLog = log.length ? log.join("\n\n") + "\n\n" + message : message;
    await db
      .update(updateRuns)
      .set({
        status: "failed",
        currentStep: null,
        buildOk: false,
        logOutput: fullLog,
      })
      .where(eq(updateRuns.id, runId));
  };

  const parsed = await resolveRepo(repo.githubUrl, repo.organizationId);
  if (!parsed) return fail("Not a repository URL on a known Git host");

  const token = parsed.token;
  if (!token) {
    return fail(
      parsed.kind === "github"
        ? "No GitHub token. Set one in the organization settings (or GITHUB_TOKEN). Required for clone and push."
        : `No ${parsed.label} token. Add ${parsed.origin} under Settings → Git hosts. Required for clone and push.`
    );
  }

  const baseBranch = repo.defaultBranch || parsed.branch;
  const packageJsonPath = repo.packageJsonPath || "package.json";
  const branchName = run_.branchName;

  let tempDir: string | null = null;

  try {
    await db
      .update(updateRuns)
      .set({ status: "updating", currentStep: "clone" })
      .where(eq(updateRuns.id, runId));

    const cloned = await cloneRepo({
      owner: parsed.owner,
      repo: parsed.repo,
      url: parsed.api.cloneUrl(),
      branch: baseBranch,
      packageJsonPath,
      token,
      prefix: "update-",
    });
    tempDir = cloned.tempDir;
    if (!cloned.ok || !tempDir) {
      throw new Error(cloned.error ?? "Clone failed");
    }
    log.push("[clone]\ncloned " + parsed.owner + "/" + parsed.repo);

    const checkout = await run("git", ["checkout", "-b", branchName], {
      cwd: tempDir,
      timeout: 10_000,
    });
    if (!checkout.ok) {
      throw new Error(
        `Create branch failed: ${checkout.stderr || checkout.stdout}`
      );
    }
    appendLog(log, "checkout", checkout.stdout, checkout.stderr);

    const projectDir = cloned.projectDir;
    const pkgPath = path.join(projectDir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`package.json not found at ${packageJsonPath}`);
    }

    // An explicit override wins; otherwise go by the lockfile in the repo.
    // Running `npm install` in a pnpm or yarn repo is how this flow used to
    // produce branches with a foreign lockfile that nobody could build.
    const manager: PackageManager =
      repo.packageManager ?? detectPackageManager(projectDir);
    log.push(`[package manager]\n${manager}`);

    await setStep("check_updates");
    // npx/npm run untrusted repo lifecycle scripts – scrub secrets from env.
    const target = opts.target ?? "minor";
    const pin = opts.pin ?? null;
    if (pin) {
      // Bulk upgrade: only this family moves, to exactly this release.
      log.push(`[target]\n${pin.family} ${pin.version} — nothing else changes`);
      const declaredPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const pinned = pinFamily(declaredPkg, pin.family, pin.version);
      if (!pinned.length)
        throw new Error(
          `${pin.family} is not used here or already at ${pin.version}.`
        );
      fs.writeFileSync(pkgPath, `${JSON.stringify(declaredPkg, null, 2)}\n`);
      log.push(`[${pin.family} ${pin.version}]\n${pinned.join("\n")}`);
    } else {
      log.push(
        target === "minor"
          ? "[target]\nminor — newest release within each major, no breaking upgrades"
          : "[target]\nlatest — majors included, expect breaking changes"
      );
      const ncu = await run(
        "npx",
        ["npm-check-updates", "-u", "--target", target],
        {
          cwd: projectDir,
          timeout: NCU_TIMEOUT_MS,
          scrubSecrets: true,
        }
      );
      appendLog(log, "ncu", ncu.stdout, ncu.stderr);
      if (!ncu.ok) {
        throw new Error(
          `npm-check-updates failed: ${ncu.stderr || ncu.stdout}`
        );
      }
    }
    // ncu moves each package on its own; packages released together (all of
    // Payload, Next.js, React) must stay at one version.
    const declared = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const aligned = alignDeclared(declared);
    if (aligned.length) {
      fs.writeFileSync(pkgPath, `${JSON.stringify(declared, null, 2)}\n`);
      log.push(`[aligned versions]\n${aligned.join("\n")}`);
    }

    await setStep("install");
    const [installCmd, installArgs] = COMMANDS[manager].install;
    const install = await run(installCmd, installArgs, {
      cwd: projectDir,
      timeout: INSTALL_TIMEOUT_MS,
      scrubSecrets: true,
    });
    appendLog(log, `${manager} install`, install.stdout, install.stderr);
    if (!install.ok) {
      throw new Error(
        `${manager} install failed: ${install.stderr || install.stdout}`
      );
    }
    // A plugin can still pull an older copy (an older @payloadcms/ui under a
    // plugin): pin those to the leader's version and install again.
    const relocked = await alignLockedFamilies(
      projectDir,
      manager,
      Object.keys({
        ...(declared.dependencies ?? {}),
        ...(declared.devDependencies ?? {}),
      }),
      (cmd, args) =>
        run(cmd, args, {
          cwd: projectDir,
          timeout: INSTALL_TIMEOUT_MS,
          scrubSecrets: true,
        })
    );
    if (Object.keys(relocked.pinned).length) {
      log.push(
        `[aligned versions]\n${Object.entries(relocked.pinned)
          .map(([k, v]) => `${k} → ${v}`)
          .join("\n")}`
      );
      const reinstall = await run(installCmd, installArgs, {
        cwd: projectDir,
        timeout: INSTALL_TIMEOUT_MS,
        scrubSecrets: true,
      });
      appendLog(
        log,
        `${manager} install (aligned)`,
        reinstall.stdout,
        reinstall.stderr
      );
    }

    await db
      .update(updateRuns)
      .set({
        status: "build_running",
        currentStep: "build",
        logOutput: log.join("\n\n"),
      })
      .where(eq(updateRuns.id, runId));

    let buildOk: boolean | null = null;
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    // On the cloud nothing from the repository runs here: its CI decides.
    const mode = effectiveVerifyMode(repo.verifyMode);
    const room = buildRoom();
    if (mode === "typecheck") {
      // No database, no secrets, little memory — see lib/typecheck.
      const tc = await runTypecheck(projectDir, tempDir);
      appendLog(log, "typecheck (tsc --noEmit)", tc.output, tc.note);
      buildOk = tc.ok !== false;
    } else if (mode === "none") {
      log.push("[check]\nnone configured — the repository's CI decides.");
      buildOk = true;
    } else if (pkgJson.scripts?.build && !room.ok) {
      log.push(room.reason);
      buildOk = false;
    } else if (pkgJson.scripts?.build) {
      const [buildCmd, buildArgs] = COMMANDS[manager].build;
      const build = await run(buildCmd, buildArgs, {
        cwd: projectDir,
        timeout: BUILD_TIMEOUT_MS,
        scrubSecrets: true,
      });
      appendLog(log, `${manager} build`, build.stdout, build.stderr);
      buildOk = build.ok;
    } else {
      log.push("[build]\nno build script – skipped");
      buildOk = true;
    }

    // Payload, Next.js and React only work with all their packages at one
    // version — a typecheck passes anyway, the deploy then fails.
    const checkOk = buildOk;
    const versions = checkInstalled(projectDir);
    const versionCheck = describeCheck(versions);
    log.push(versionCheck.log);
    if (!versions.ok) buildOk = false;

    await setStep("commit_push", { buildOk });

    await run("git", ["config", "user.email", "moatline@local"], {
      cwd: tempDir,
    });
    await run("git", ["config", "user.name", "Moatline"], {
      cwd: tempDir,
    });
    const relPkg = path.relative(
      tempDir,
      path.join(projectDir, "package.json")
    );
    const toAdd = [relPkg];
    const lockPath = path.join(projectDir, LOCKFILES[manager]);
    if (fs.existsSync(lockPath)) toAdd.push(path.relative(tempDir, lockPath));
    const add = await run("git", ["add", ...toAdd], { cwd: tempDir });
    if (!add.ok) {
      const addAll = await run(
        "git",
        ["add", path.relative(tempDir, projectDir)],
        { cwd: tempDir }
      );
      if (!addAll.ok) throw new Error(`git add failed: ${addAll.stderr}`);
    }
    const commit = await run(
      "git",
      ["commit", "-m", `chore(deps): update dependencies [${branchName}]`],
      { cwd: tempDir }
    );
    const nothingToCommit =
      !commit.ok &&
      (commit.stdout + commit.stderr).includes("nothing to commit");
    if (!commit.ok && !nothingToCommit) {
      throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
    }
    appendLog(log, "git commit", commit.stdout, commit.stderr);
    if (nothingToCommit) {
      throw new Error(
        "Nothing to update – every dependency is already at its latest version."
      );
    }

    const push = await run("git", ["push", "origin", branchName], {
      cwd: tempDir,
      timeout: 60_000,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (!push.ok) {
      throw new Error(`git push failed: ${push.stderr || push.stdout}`);
    }
    appendLog(log, "git push", push.stdout, push.stderr);

    // A pushed branch nobody finds is no help: open the PR, and say in it
    // what the check found.
    await setStep("pr", { buildOk });
    const check =
      mode === "none"
        ? "— left to the repository's CI"
        : checkOk
          ? "✅ passed"
          : "❌ failed — see the log in Moatline";
    const pr = await parsed.api.createPr({
      head: branchName,
      base: baseBranch,
      title: pin
        ? `chore(deps): ${pin.family} ${pin.version}`
        : `chore(deps): ${target === "minor" ? "minor and patch updates" : "update dependencies to latest"}`,
      body: [
        pin
          ? `${pin.family} ${pin.version} by **Moatline** — every ${pin.family} package to this release, nothing else (${manager}).`
          : `Dependency update by **Moatline** (\`npm-check-updates --target ${target}\`, ${manager}).`,
        "",
        `- ${mode === "build" ? "Build" : mode === "typecheck" ? "Typecheck" : "Check"}: ${check}`,
        ...(versionCheck.line ? [versionCheck.line] : []),
        ...(aligned.length
          ? [`- Aligned to one version: ${aligned.join(", ")}`]
          : []),
        pin
          ? `- Read the ${pin.family} release notes for migrations before merging.`
          : target === "latest"
            ? "- ⚠️ Includes major versions — read the changelogs before merging."
            : "- Minor and patch releases only.",
      ].join("\n"),
    });
    if (!pr.ok) appendLog(log, "pull request", "", pr.error);
    await db
      .update(updateRuns)
      .set({
        status: pr.ok ? "pr_opened" : "pushed",
        currentStep: null,
        buildOk,
        ...(pr.ok ? { prNumber: pr.number, prUrl: pr.url } : {}),
        logOutput: log.join("\n\n"),
      })
      .where(eq(updateRuns.id, runId));
    if (pr.ok)
      emitEvent(repo.organizationId, {
        name: "pr.opened",
        title: `Update PR opened for ${repo.name}`,
        severity: "info",
        repository: repo,
        attributes: {
          "pr.url": pr.url,
          "pr.kind": "update",
          check: mode,
          "check.passed": buildOk,
        },
      });
    await notify(repo.organizationId, {
      type: buildOk ? "autofix_pr_opened" : "workflow_failed",
      title: buildOk
        ? `Update PR opened for ${repo.name}`
        : `Update for ${repo.name}: ${mode} failed on the branch`,
      message: buildOk
        ? `${pin ? `${pin.family} ${pin.version}` : target === "minor" ? "Minor/patch" : "Latest"} updates · ${mode === "none" ? "checked by CI" : `${mode} passed`}`
        : "Review the PR before merging — the log in Moatline shows what failed.",
      url: pr.ok ? pr.url : parsed.api.compareUrl(baseBranch, branchName),
    }).catch(() => {});
  } catch (err) {
    await fail(
      failedWhile(phase, err instanceof Error ? err.message : "Update failed")
    );
  } finally {
    cleanupClone(tempDir);
  }
}
