import fs from "node:fs";
import { effectiveVerifyMode } from "../lib/cloud";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, updateRuns, repositories } from "db";
import { resolveRepo, waitForHostChecks } from "../lib/git-host";
import { run, appendLog, buildMemoryMb } from "../lib/run";
import { runTypecheck } from "../lib/typecheck";
import { checkInstalled, checkLocked, describeCheck } from "../lib/lockstep";
import {
  alignLockedFamilies,
  applyPnpmOverrides,
  auditLockfile,
  pnpmOverrides,
  relockCommand,
} from "../lib/lockfile-fix";
import { availableMemoryMb, withHeavySlot } from "../lib/heavy-jobs";
import type { Vulnerability } from "../lib/audit";
import {
  applyYarnResolutions,
  findLockfile,
  managerCommands,
  yarnResolutions,
} from "../lib/fix-strategy";
import { cloneRepo, cleanupClone } from "./clone";
import { notify } from "../lib/notify";
import { deployRepository } from "./deploy";
import { startRunHeartbeat } from "./run-heartbeat";
import { failedWhile } from "../lib/run-phase";
import { hasDeployTarget } from "./platforms";
import { emitEvent } from "../lib/events";
import { auditRaw } from "../lib/audit-log";

const NPM_INSTALL_TIMEOUT_MS = 300_000;
const AUDIT_FIX_TIMEOUT_MS = 300_000;
const BUILD_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 300_000;

// Only files the auto-fix is allowed to touch. Anything else and we refuse to
// auto-merge (a guardrail against audit fix rewriting source).
const ALLOWED_CHANGED = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
]);

/** Whether a package.json script exists and isn't the npm "no test" stub. Exported for testing. */
export function hasRealScript(
  scripts: Record<string, string> | undefined,
  name: string
): boolean {
  const s = scripts?.[name];
  if (!s) return false;
  if (name === "test" && /no test specified/i.test(s)) return false;
  return true;
}

/**
 * Advisory identity for before/after comparison. GHSA ids are stable; without
 * one, the package plus the affected range is the closest substitute.
 */
function advisoryKey(v: Vulnerability): string {
  return v.ghsaId ?? `${v.packageName}@${v.vulnerableRange ?? v.title ?? ""}`;
}

export type FixVerification = {
  /** Gone after the fix — what the run actually achieved. */
  resolved: Vulnerability[];
  /** Still there afterwards. */
  remaining: Vulnerability[];
  /** Present only afterwards: the fix pulled in a new vulnerable version. */
  introduced: Vulnerability[];
};

/** Compare the audit before the fix with the audit after it. Exported for testing. */
export function verifyFix(
  before: Vulnerability[],
  after: Vulnerability[]
): FixVerification {
  const beforeKeys = new Set(before.map(advisoryKey));
  const afterKeys = new Set(after.map(advisoryKey));
  return {
    resolved: before.filter((v) => !afterKeys.has(advisoryKey(v))),
    remaining: after.filter((v) => beforeKeys.has(advisoryKey(v))),
    introduced: after.filter((v) => !beforeKeys.has(advisoryKey(v))),
  };
}

/** One line a human can act on, from a verification result. */
export function summarizeFix(v: FixVerification): string {
  const parts = [
    `${v.resolved.length} resolved`,
    `${v.remaining.length} remaining`,
  ];
  if (v.introduced.length > 0) parts.push(`${v.introduced.length} introduced`);
  const names = v.resolved
    .map((x) => x.ghsaId ?? x.packageName)
    .slice(0, 5)
    .join(", ");
  return names ? `${parts.join(", ")} — fixed: ${names}` : parts.join(", ");
}

/** Parse `git status --porcelain` into a list of changed paths (basenames). Exported for testing. */
export function changedBasenames(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      path.basename(l.replace(/^\S+\s+/, "").replace(/^.*->\s*/, ""))
    );
}

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

/**
 * Fixes run right away: the lockfile work is light. Only an install or a
 * build inside a fix waits for the shared slot (see withHeavySlot).
 */
export function runSecurityFix(updateRunId: string): Promise<void> {
  const stop = startRunHeartbeat(updateRunId);
  return runSecurityFixNow(updateRunId).finally(stop);
}

async function runSecurityFixNow(updateRunId: string): Promise<void> {
  const [runRow] = await db
    .select()
    .from(updateRuns)
    .where(eq(updateRuns.id, updateRunId));
  if (!runRow) return;
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, runRow.repositoryId));
  if (!repo) return;

  const parsed = await resolveRepo(repo.githubUrl, repo.organizationId);
  const token = parsed?.token ?? null;
  const log: string[] = [];

  const fail = async (msg: string) => {
    const full = log.length ? `${log.join("\n\n")}\n\n${msg}` : msg;
    await db
      .update(updateRuns)
      .set({
        status: "failed",
        currentStep: null,
        buildOk: false,
        logOutput: full,
      })
      .where(eq(updateRuns.id, updateRunId));
    await notify(repo.organizationId, {
      type: "workflow_failed",
      title: `Security auto-fix failed for ${repo.name}`,
      message: msg,
    }).catch(() => {});
  };

  if (!parsed) return fail("Not a repository URL on a known Git host");
  if (!token)
    return fail(
      parsed.kind === "github"
        ? "No GitHub token – set one in the organization settings (or GITHUB_TOKEN). Required for clone/PR/push."
        : `No ${parsed.label} token – add ${parsed.origin} under Settings → Git hosts. Required for clone/PR/push.`
    );

  const baseBranch = repo.defaultBranch || parsed.branch;
  const packageJsonPath = repo.packageJsonPath || "package.json";
  const branchName = runRow.branchName;
  let tempDir: string | null = null;

  /**
   * Publish the phase inside the current status together with the log so far.
   * A fix run spends minutes in "updating" and "build_running"; without this
   * the UI cannot tell a slow install from a hung one.
   */
  let phase: string | null = null;
  const setStep = async (step: string | null) => {
    if (step) phase = step;
    await db
      .update(updateRuns)
      .set({ currentStep: step, logOutput: log.join("\n\n") })
      .where(eq(updateRuns.id, updateRunId));
  };

  try {
    await db
      .update(updateRuns)
      .set({ status: "updating", currentStep: "clone" })
      .where(eq(updateRuns.id, updateRunId));

    const cloned = await cloneRepo({
      owner: parsed.owner,
      repo: parsed.repo,
      url: parsed.api.cloneUrl(),
      branch: baseBranch,
      packageJsonPath,
      token,
      prefix: "secfix-",
    });
    tempDir = cloned.tempDir;
    if (!cloned.ok || !tempDir) throw new Error(cloned.error ?? "Clone failed");
    const projectDir = cloned.projectDir;
    const pkgPath = path.join(projectDir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`package.json not found at ${packageJsonPath}`);
    }

    const checkout = await run("git", ["checkout", "-b", branchName], {
      cwd: tempDir,
      timeout: 10_000,
    });
    if (!checkout.ok) {
      throw new Error(
        `Create branch failed: ${checkout.stderr || checkout.stdout}`
      );
    }

    // Each manager fixes in its own way and commits its own lockfile — npm
    // in a pnpm repo would resolve a fresh npm tree and commit a lockfile the
    // project does not use. In a workspace the lockfile (and so install,
    // audit and the fix) lives at the root, not next to the package.
    const lock = findLockfile(projectDir, tempDir);
    const manager = repo.packageManager ?? lock?.manager ?? "npm";
    const workDir = lock?.dir ?? projectDir;
    const cmds = managerCommands(manager);
    // Yarn berry refuses to touch the lockfile in CI-like environments.
    const pmEnv = { YARN_ENABLE_IMMUTABLE_INSTALLS: "false" };
    log.push(
      `[package manager] ${manager}${workDir !== projectDir ? ` (workspace root ${path.relative(tempDir, workDir) || "."})` : ""}`
    );

    // No install for the fix itself: the lockfile says exactly what is
    // installed, the advisory database what is vulnerable, and each package
    // manager can re-resolve its lockfile without downloading anything.
    // Installing (1,000+ packages) only happens when a check needs it.
    const readDeps = (dir: string) => {
      const p = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8")
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return { ...p.devDependencies, ...p.dependencies };
    };
    const depsBefore = readDeps(projectDir);
    const direct = new Set(Object.keys(depsBefore));
    if (
      manager === "npm" &&
      !fs.existsSync(path.join(workDir, "package-lock.json"))
    ) {
      const [cmd, args] = relockCommand("npm", workDir);
      const lockOnly = await run(cmd, args, {
        cwd: workDir,
        timeout: NPM_INSTALL_TIMEOUT_MS,
        scrubSecrets: true,
      });
      appendLog(
        log,
        "npm install --package-lock-only",
        lockOnly.stdout,
        lockOnly.stderr
      );
    }

    // The state to compare against afterwards. Without this the run can only
    // report that something changed, never that anything was fixed.
    const auditBefore = await auditLockfile(workDir, manager, direct);
    appendLog(
      log,
      "audit (before fix)",
      auditBefore.supported
        ? `${auditBefore.vulnerabilities.length} advisories in ${auditBefore.packages.length} locked packages`
        : "",
      auditBefore.note ?? ""
    );

    await setStep("audit_fix");
    if (manager === "npm") {
      const fixArgs = [
        "audit",
        "fix",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...(repo.autoFixForce ? ["--force"] : []),
      ];
      const fix = await run("npm", fixArgs, {
        cwd: workDir,
        timeout: AUDIT_FIX_TIMEOUT_MS,
        scrubSecrets: true,
      });
      appendLog(log, `npm ${fixArgs.join(" ")}`, fix.stdout, fix.stderr);
    } else if (manager === "pnpm") {
      const plan = pnpmOverrides(
        auditBefore.vulnerabilities,
        auditBefore.packages,
        repo.autoFixForce,
        Object.keys(depsBefore)
      );
      const n = applyPnpmOverrides(workDir, plan.overrides);
      log.push(
        `[overrides] ${
          n
            ? Object.entries(plan.overrides)
                .map(([k, v]) => `${k} → ${v}`)
                .join(", ")
            : "nothing to override"
        }${plan.skipped.length ? `\nleft for a human: ${plan.skipped.join("; ")}` : ""}`
      );
    } else {
      // Yarn has no audit fix: pin each vulnerable package to its patched
      // version via `resolutions` (root package.json only, as yarn requires).
      const res = yarnResolutions(auditBefore.vulnerabilities);
      const n = applyYarnResolutions(path.join(workDir, "package.json"), res);
      log.push(
        n
          ? `[resolutions] ${Object.entries(res)
              .map(([k, v]) => `${k}@${v}`)
              .join(", ")}`
          : "[resolutions] the audit reports no patched versions to pin."
      );
    }
    if (manager !== "npm") {
      const [cmd, args] = relockCommand(manager, workDir);
      const relock = await run(cmd, args, {
        cwd: workDir,
        timeout: NPM_INSTALL_TIMEOUT_MS,
        scrubSecrets: true,
        env: pmEnv,
      });
      appendLog(log, `${cmd} ${args.join(" ")}`, relock.stdout, relock.stderr);
      if (!relock.ok) {
        throw new Error(
          `Updating the lockfile failed: ${relock.stderr.slice(0, 500)}`
        );
      }
    }

    // Packages released together must end at one version — repair it here
    // instead of failing the deploy later.
    const aligned = await alignLockedFamilies(
      workDir,
      manager,
      Object.keys(depsBefore),
      (cmd, args) =>
        run(cmd, args, {
          cwd: workDir,
          timeout: NPM_INSTALL_TIMEOUT_MS,
          scrubSecrets: true,
          env: pmEnv,
        })
    );
    if (Object.keys(aligned.pinned).length) {
      log.push(
        `[aligned versions]\n${Object.entries(aligned.pinned)
          .map(([k, v]) => `${k} → ${v}`)
          .join(
            "\n"
          )}${aligned.ok ? "" : `\nre-resolving failed: ${aligned.output.slice(0, 500)}`}`
      );
    }

    // Did anything change? If not, there's nothing to fix.
    const status = await run("git", ["status", "--porcelain"], {
      cwd: tempDir,
    });
    const changed = changedBasenames(status.stdout);
    if (changed.length === 0) {
      await db
        .update(updateRuns)
        .set({
          status: "pushed",
          currentStep: null,
          buildOk: true,
          logOutput: `${log.join("\n\n")}\n\nNo fixable changes – ${cmds.fixLabel} produced no diff.`,
        })
        .where(eq(updateRuns.id, updateRunId));
      await notify(repo.organizationId, {
        type: "workflow_failed",
        title: `No auto-fix available for ${repo.name}`,
        message: `${cmds.fixLabel} produced no changes (fixes may require manual major upgrades).`,
      }).catch(() => {});
      return;
    }
    const onlyDeps = changed.every((f) => ALLOWED_CHANGED.has(f));

    // Audit again: a diff proves something moved, not that the advisory is
    // gone. This is what turns "we ran a fix" into "GHSA-xxxx no longer
    // applies" — and it can also reveal a fix that pulled in a new one.
    const auditAfter = await auditLockfile(workDir, manager, direct);
    const verification =
      auditBefore.supported && auditAfter.supported
        ? verifyFix(auditBefore.vulnerabilities, auditAfter.vulnerabilities)
        : null;
    const fixVerified = verification
      ? verification.resolved.length > 0 && verification.introduced.length === 0
      : null;
    const fixSummary = verification
      ? summarizeFix(verification)
      : (auditAfter.note ??
        "Audit unavailable – the fix could not be verified.");
    appendLog(log, "audit (after fix)", fixSummary, "");
    await db
      .update(updateRuns)
      .set({
        securityVerified: fixVerified,
        securitySummary: fixSummary,
        logOutput: log.join("\n\n"),
      })
      .where(eq(updateRuns.id, updateRunId));

    // Check the change in the temp clone (our own gate, not GitHub CI). How
    // depends on the repo: a typecheck needs no database; a full build of a
    // Payload/Next.js app that renders from its database cannot pass here.
    await db
      .update(updateRuns)
      .set({
        status: "build_running",
        currentStep: "build",
        logOutput: log.join("\n\n"),
      })
      .where(eq(updateRuns.id, updateRunId));
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    // On the cloud nothing from the repository runs here: its CI decides.
    const mode = effectiveVerifyMode(repo.verifyMode);
    let buildOk = true;
    let testsOk = true;
    let buildSkipped = false;
    // Whether our own check proved anything. If not, auto-merge needs CI.
    let checkedLocally = false;
    let checkLine = "";
    // Moving locked versions within their major is what any install of the
    // repository does anyway; it cannot break the code's types. Only a
    // changed dependency in package.json, a major upgrade or a full build
    // needs the packages on disk.
    const depsAfter = readDeps(projectDir);
    const declaredChanged = Object.keys({ ...depsBefore, ...depsAfter }).some(
      (k) => depsBefore[k] !== depsAfter[k]
    );
    const needsInstall =
      mode === "build" ||
      (mode === "typecheck" && (declaredChanged || repo.autoFixForce));
    // Only installing and building is heavy — the fix itself was a few
    // seconds of lockfile work and never queues. Those steps wait for the
    // one build slot, so parallel runs cannot overload the server.
    const verify = async () => {
      if (needsInstall) {
        await setStep("install");
        const install = await run(cmds.install[0], cmds.install[1], {
          cwd: workDir,
          timeout: NPM_INSTALL_TIMEOUT_MS,
          scrubSecrets: true,
          env: pmEnv,
        });
        appendLog(log, `${manager} install`, install.stdout, install.stderr);
        if (!install.ok) {
          throw new Error(
            `${manager} install failed: ${install.stderr.slice(0, 500)}`
          );
        }
        await setStep("build");
      }
      if (mode === "typecheck" && !needsInstall) {
        log.push(
          "[check]\ntypecheck not needed — only locked versions moved, each within its major; nothing was installed on this server."
        );
        checkedLocally = true;
        checkLine =
          "- Typecheck: — not needed, only the lockfile changed (within each package's major)";
      } else if (mode === "typecheck") {
        const tc = await runTypecheck(projectDir, workDir, pmEnv);
        appendLog(log, "typecheck (tsc --noEmit)", tc.output, tc.note);
        buildOk = tc.ok !== false;
        checkedLocally = tc.ok === true;
        checkLine = `- Typecheck: ${tc.ok === true ? "✅ passed" : tc.ok === false ? "❌ failed" : `— ${tc.note}`}`;
      } else if (mode === "build") {
        const room = buildRoom();
        if (hasRealScript(pkgJson.scripts, "build") && !room.ok) {
          log.push(room.reason);
          buildOk = false;
          buildSkipped = true;
        } else if (hasRealScript(pkgJson.scripts, "build")) {
          const build = await run(cmds.build[0], cmds.build[1], {
            cwd: projectDir,
            timeout: BUILD_TIMEOUT_MS,
            scrubSecrets: true,
            env: pmEnv,
          });
          appendLog(log, `${manager} run build`, build.stdout, build.stderr);
          buildOk = build.ok;
        }
        if (hasRealScript(pkgJson.scripts, "test")) {
          await setStep("test");
          const test = await run(cmds.test[0], cmds.test[1], {
            cwd: projectDir,
            timeout: TEST_TIMEOUT_MS,
            scrubSecrets: true,
            env: pmEnv,
          });
          appendLog(log, `${manager} test`, test.stdout, test.stderr);
          testsOk = test.ok;
        }
        checkedLocally =
          !buildSkipped &&
          (hasRealScript(pkgJson.scripts, "build") ||
            hasRealScript(pkgJson.scripts, "test"));
        checkLine = [
          `- Build: ${buildOk ? (hasRealScript(pkgJson.scripts, "build") ? "✅ passed" : "— none") : buildSkipped ? "⏭️ skipped — not enough free memory on the Moatline server; let CI verify" : "❌ failed"}`,
          `- Tests: ${testsOk ? (hasRealScript(pkgJson.scripts, "test") ? "✅ passed" : "— none") : "❌ failed"}`,
        ].join("\n");
      } else {
        log.push("[check]\nnone configured — the repository's CI decides.");
        checkLine = "- Check: — left to the repository's CI";
      }
    };
    if (needsInstall) {
      await withHeavySlot(verify, async (ahead) => {
        log.push(
          `[queue]\nwaiting for ${ahead === 1 ? "another build" : `${ahead} other builds`} to finish — builds run one at a time so they cannot overload the server.`
        );
        await setStep("waiting");
      });
    } else {
      await verify();
    }

    // Payload, Next.js and React only work with all their packages at one
    // version — a typecheck passes anyway, the deploy then fails.
    const versions = needsInstall
      ? checkInstalled(projectDir)
      : checkLocked(auditAfter.packages, Object.keys(depsAfter));
    const versionCheck = describeCheck(versions);
    log.push(versionCheck.log);
    if (versionCheck.line) checkLine = `${checkLine}\n${versionCheck.line}`;
    if (!versions.ok) buildOk = false;
    const green = buildOk && testsOk;

    // Commit + push.
    await setStep("commit_push");
    await run("git", ["config", "user.email", "moatline@local"], {
      cwd: tempDir,
    });
    await run("git", ["config", "user.name", "Moatline"], {
      cwd: tempDir,
    });
    await run("git", ["add", "-A"], { cwd: tempDir });
    const commit = await run(
      "git",
      ["commit", "-m", `fix(security): apply ${cmds.fixLabel} [${branchName}]`],
      { cwd: tempDir }
    );
    if (!commit.ok && !commit.stderr.includes("nothing to commit")) {
      throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
    }
    const push = await run("git", ["push", "origin", branchName], {
      cwd: tempDir,
      timeout: 60_000,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (!push.ok)
      throw new Error(`git push failed: ${push.stderr || push.stdout}`);
    appendLog(log, "git push", push.stdout, "");

    // Open the PR.
    await setStep("pr");
    const prBody = [
      `Automated security fix by **Moatline** (\`${cmds.fixLabel}\`).`,
      "",
      checkLine,
      `- Changed files: ${changed.join(", ")}`,
      onlyDeps
        ? ""
        : "\n⚠️ Changes touch files beyond package.json/lockfile – review carefully.",
    ]
      .filter(Boolean)
      .join("\n");
    const pr = await parsed.api.createPr({
      head: branchName,
      base: baseBranch,
      title: `fix(security): automated ${cmds.fixLabel}`,
      body: prBody,
    });
    if (!pr.ok) {
      await db
        .update(updateRuns)
        .set({
          status: "pushed",
          currentStep: null,
          buildOk,
          logOutput: `${log.join("\n\n")}\n\nPR creation failed: ${pr.error}`,
        })
        .where(eq(updateRuns.id, updateRunId));
      await notify(repo.organizationId, {
        type: "workflow_failed",
        title: `Security fix pushed but PR failed for ${repo.name}`,
        message: pr.error,
      }).catch(() => {});
      return;
    }
    await db
      .update(updateRuns)
      .set({
        status: "pr_opened",
        currentStep: null,
        buildOk,
        prNumber: pr.number,
        prUrl: pr.url,
        logOutput: log.join("\n\n"),
      })
      .where(eq(updateRuns.id, updateRunId));
    emitEvent(repo.organizationId, {
      name: "pr.opened",
      title: `Security fix PR opened for ${repo.name}`,
      severity: "info",
      repository: repo,
      attributes: {
        "pr.url": pr.url,
        "pr.kind": "security",
        check: mode,
        "check.passed": green,
      },
    });
    await notify(repo.organizationId, {
      type: "autofix_pr_opened",
      title: `Security fix PR opened for ${repo.name}`,
      message: `${mode === "none" ? "Checked by CI" : `${mode === "typecheck" ? "Typecheck" : "Build/tests"} ${green ? "✓" : "✗"}`} · ${changed.join(", ")}`,
      url: pr.url,
    }).catch(() => {});
    const source = runRow.triggerSource ?? "manual";
    const apiKey = runRow.triggerDetail?.apiKey;
    await auditRaw({
      organizationId: repo.organizationId,
      action: "security_fix.pr_opened",
      userEmail:
        source === "mcp" && apiKey
          ? `mcp:${apiKey}`
          : source === "auto"
            ? "moatline:auto_fix"
            : null,
      target: { type: "repository", id: repo.id, name: repo.name },
      detail: {
        source,
        runId: updateRunId,
        prUrl: pr.url,
        prNumber: pr.number,
        ...(apiKey ? { apiKey } : {}),
      },
    });

    // ---- Auto-merge (opt-in, guarded) ----
    if (!repo.autoMerge) return;
    if (!green) {
      log.push(`Auto-merge skipped: ${mode} check not green.`);
      await db
        .update(updateRuns)
        .set({ logOutput: log.join("\n\n") })
        .where(eq(updateRuns.id, updateRunId));
      return;
    }
    if (!onlyDeps) {
      log.push(
        "Auto-merge skipped: diff touches files beyond package.json/lockfile."
      );
      await db
        .update(updateRuns)
        .set({ logOutput: log.join("\n\n") })
        .where(eq(updateRuns.id, updateRunId));
      return;
    }
    // Merging a "security fix" that fixed nothing – or that introduced a new
    // advisory – is worse than leaving the PR open for a human.
    if (fixVerified !== true) {
      log.push(`Auto-merge skipped: fix not verified (${fixSummary}).`);
      await db
        .update(updateRuns)
        .set({ logOutput: log.join("\n\n"), currentStep: "merge_held" })
        .where(eq(updateRuns.id, updateRunId));
      await notify(repo.organizationId, {
        type: "workflow_failed",
        title: `Security fix not verified for ${repo.name}`,
        message: `The PR is open but was not merged automatically: ${fixSummary}`,
        url: pr.url,
      }).catch(() => {});
      return;
    }

    // Our own build ran in a temp clone; it is not the repository's CI. Merging
    // before the host's checks report would bypass exactly the gate the team set
    // up. "none" is passed through deliberately: a repo without CI cannot be
    // waited for, and that fact is written into the log rather than hidden.
    await db
      .update(updateRuns)
      .set({ currentStep: "ci", logOutput: log.join("\n\n") })
      .where(eq(updateRuns.id, updateRunId));
    const checks = await waitForHostChecks(parsed.api, branchName);
    log.push(`CI checks: ${checks.state} (${checks.detail}).`);
    // Without a local check that proved something, only a green CI may
    // merge — "no CI" is then not enough.
    if (
      checks.state !== "success" &&
      (checks.state !== "none" || !checkedLocally)
    ) {
      log.push("Auto-merge skipped: CI did not report success.");
      await db
        .update(updateRuns)
        .set({ logOutput: log.join("\n\n"), currentStep: "merge_held" })
        .where(eq(updateRuns.id, updateRunId));
      await notify(repo.organizationId, {
        type: "workflow_failed",
        title: `Auto-merge held back for ${repo.name}`,
        message:
          checks.state === "none"
            ? "No CI ran on the fix branch and nothing was checked here, so it is not merged automatically. The PR is open for review."
            : `CI on the fix branch is ${checks.state}: ${checks.detail}. The PR is open for review.`,
        url: pr.url,
      }).catch(() => {});
      return;
    }

    const merge = await parsed.api.mergePr(pr.number);
    if (!merge.ok) {
      log.push(`Auto-merge failed: ${merge.error}`);
      await db
        .update(updateRuns)
        .set({ logOutput: log.join("\n\n"), currentStep: "merge_held" })
        .where(eq(updateRuns.id, updateRunId));
      await notify(repo.organizationId, {
        type: "workflow_failed",
        title: `Auto-merge failed for ${repo.name}`,
        message: merge.error,
      }).catch(() => {});
      return;
    }
    await db
      .update(updateRuns)
      .set({
        status: "merged",
        merged: true,
        mergeSha: merge.sha ?? null,
        logOutput: log.join("\n\n"),
      })
      .where(eq(updateRuns.id, updateRunId));
    await notify(repo.organizationId, {
      type: "autofix_merged",
      title: `Security fix merged for ${repo.name}`,
      message: "PR merged to the default branch.",
      url: pr.url,
    }).catch(() => {});

    // ---- Auto-deploy (opt-in) ----
    if (!repo.autoDeploy) return;
    if (!hasDeployTarget(repo)) {
      log.push(
        "Auto-deploy skipped: no Dokploy or Coolify application on this repo."
      );
      await db
        .update(updateRuns)
        .set({ logOutput: log.join("\n\n") })
        .where(eq(updateRuns.id, updateRunId));
      return;
    }
    await db
      .update(updateRuns)
      .set({ status: "deploying" })
      .where(eq(updateRuns.id, updateRunId));
    const deploy = await deployRepository(repo.id, updateRunId, {
      afterMerge: true,
    });
    await db
      .update(updateRuns)
      .set({
        status: deploy.ok ? "deployed" : "merged",
        logOutput: `${log.join("\n\n")}\n\nDeploy: ${deploy.ok ? "triggered" : `failed – ${deploy.error}`}`,
      })
      .where(eq(updateRuns.id, updateRunId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Security fix failed";
    await fail(failedWhile(phase, message));
  } finally {
    cleanupClone(tempDir);
  }
}
