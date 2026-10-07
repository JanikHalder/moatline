import pLimit from "p-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  db,
  scans,
  packageFindings,
  vulnerabilities,
  repositories,
  updateRuns,
} from "db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Under tsx this file sits in src/services; in the production bundle it sits
// in dist. Both layouts keep the app root two levels up, but the depcheck
// child script is only shipped as source, so look for it in either place.
const API_ROOT = path.resolve(__dirname, "../..");
const RUN_DEPCHECK_SCRIPT =
  [
    path.join(API_ROOT, "src/scripts/run-depcheck.mjs"),
    path.join(__dirname, "scripts/run-depcheck.mjs"),
  ].find((candidate) => fs.existsSync(candidate)) ??
  path.join(API_ROOT, "src/scripts/run-depcheck.mjs");
import { eq, and, desc, inArray } from "drizzle-orm";
import { resolveRepo, type RepoHandle } from "../lib/git-host";
import { cloneRepo, cleanupClone } from "./clone";
import { run } from "../lib/run";
import { runAudit, type AuditResult, type Vulnerability } from "../lib/audit";
import {
  LOCKFILE_NAMES,
  lockfileCandidates,
  parseLockfile,
} from "../lib/lockfile";
import { lookupAdvisories } from "../lib/advisories";
import { auditLockfile } from "../lib/lockfile-fix";
import { findLockfile } from "../lib/fix-strategy";
import type { PackageManager } from "../lib/package-manager";
import { notify } from "../lib/notify";
import { runSecurityFix } from "./security-fix";
import { buildStack } from "../lib/stack";

const npmConcurrency = 10;
const NPM_FETCH_TIMEOUT_MS = 15_000;
const FETCH_VERSIONS_PHASE_TIMEOUT_MS = 5 * 60 * 1000;
const limit = pLimit(npmConcurrency);

const NPM_REGISTRY = "https://registry.npmjs.org";

type FetchPackageResult =
  | {
      ok: true;
      pkg: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
    }
  | { ok: false; error: string };

/** Where a token for a host is set, for error messages. */
function tokenHint(h: RepoHandle): string {
  return h.kind === "github"
    ? "organization settings, or GITHUB_TOKEN"
    : `Settings → Git hosts → ${h.label}`;
}

async function fetchPackageJson(
  h: RepoHandle,
  branch: string,
  pathToPackageJson: string
): Promise<FetchPackageResult> {
  const path = pathToPackageJson || "package.json";
  const res = await h.api.readFile(path, branch);
  if (!res.ok) {
    if (res.status === 404) {
      return {
        ok: false,
        error: h.token
          ? `${h.label} 404 – branch "${branch}" or path "${path}" not found. Check branch and root directory.`
          : `Public repo 404 – branch "${branch}" or path "${path}" not found. Private repos need a ${h.label} token (${tokenHint(h)}).`,
      };
    }
    if (res.status === 401) {
      return {
        ok: false,
        error: `${h.label} 401 – the ${h.label} token is invalid or expired (${tokenHint(h)}).`,
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        error: `${h.label} 403 – token missing or insufficient (read access to the code). ${res.error}`,
      };
    }
    return { ok: false, error: `${h.label} ${res.status}: ${res.error}` };
  }
  try {
    const pkg = JSON.parse(res.text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ok: true, pkg };
  } catch {
    return { ok: false, error: "Invalid JSON in package.json" };
  }
}

/** Run the depcheck child script on a cloned project dir. Never throws. */
async function runDepcheck(projectDir: string): Promise<Set<string>> {
  // Untrusted: depcheck reads the repository's files — no secrets in its env.
  const child = await run(process.execPath, [RUN_DEPCHECK_SCRIPT, projectDir], {
    cwd: API_ROOT,
    timeout: 90_000,
    scrubSecrets: true,
  });
  if (!child.ok || child.stderr) {
    if (child.stderr.trim()) {
      console.warn(
        "[api] depcheck child stderr:",
        child.stderr.trim().slice(0, 500)
      );
    }
    return new Set();
  }
  let result: { dependencies?: string[]; devDependencies?: string[] };
  try {
    result = JSON.parse(child.stdout || "{}");
  } catch {
    return new Set();
  }
  return new Set<string>([
    ...(result.dependencies ?? []),
    ...(result.devDependencies ?? []),
  ]);
}

/**
 * Clone the repo ONCE and run both depcheck (unused deps) and npm audit
 * (vulnerabilities) against the same working copy. Owns its temp dir cleanup.
 * Never throws – a clone/analysis failure degrades to empty results so the
 * version-diff findings are still produced.
 */
async function analyzeClone(
  h: RepoHandle,
  branch: string,
  pathToPackageJson: string,
  onAuditPhase?: () => void,
  commit?: string | null
): Promise<{ unused: Set<string>; audit: AuditResult }> {
  const emptyAudit: AuditResult = {
    supported: false,
    manager: "npm",
    vulnerabilities: [],
  };
  const cloned = await cloneRepo({
    owner: h.owner,
    repo: h.repo,
    url: h.api.cloneUrl(),
    branch,
    commit,
    packageJsonPath: pathToPackageJson,
    token: h.token,
    prefix: "scan-",
  });
  try {
    if (!cloned.ok || !cloned.tempDir) {
      return {
        unused: new Set(),
        audit: { ...emptyAudit, note: cloned.error },
      };
    }
    if (!fs.existsSync(path.join(cloned.projectDir, "package.json"))) {
      return {
        unused: new Set(),
        audit: { ...emptyAudit, note: "package.json not found in clone" },
      };
    }
    const unused = await runDepcheck(cloned.projectDir);
    onAuditPhase?.();
    // The same advisory lookup as the light scan, on the cloned lockfile —
    // no `pnpm audit` (which first insists on switching to the exact pnpm
    // version in package.json) and results that match the light scans.
    // Only without a lockfile does the package manager have to resolve one.
    const lock = findLockfile(cloned.projectDir, cloned.tempDir);
    if (lock) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(cloned.projectDir, "package.json"), "utf8")
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const audited = await auditLockfile(
        lock.dir,
        lock.manager,
        new Set(Object.keys({ ...pkg.devDependencies, ...pkg.dependencies }))
      );
      return {
        unused,
        audit: {
          supported: audited.supported,
          manager: audited.manager,
          vulnerabilities: audited.vulnerabilities,
          note: audited.note,
        },
      };
    }
    const audit = await runAudit(cloned.projectDir);
    return { unused, audit };
  } catch (e) {
    console.error("[api] analyzeClone error:", e);
    return { unused: new Set(), audit: emptyAudit };
  } finally {
    cleanupClone(cloned.tempDir);
  }
}

/** A file from the repository at a ref, or null when it is not there. */
async function fetchRepoText(
  h: RepoHandle,
  ref: string,
  filePath: string
): Promise<string | null> {
  const res = await h.api.readFile(filePath, ref).catch(() => null);
  return res?.ok ? res.text : null;
}

/**
 * The light way to find CVEs: read the lockfile through the GitHub API and
 * ask the advisory database about the exact versions in it. No clone, no
 * install, no child processes — so many scans at once cost next to nothing.
 * null when the repository has no lockfile (then only a clone can resolve
 * the versions).
 */
async function analyzeLockfile(
  h: RepoHandle,
  ref: string,
  pathToPackageJson: string,
  directDeps: string[]
): Promise<{ unused: Set<string>; audit: AuditResult } | null> {
  for (const candidate of lockfileCandidates(pathToPackageJson)) {
    const text = await fetchRepoText(h, ref, candidate);
    if (text == null) continue;
    const file = candidate.split("/").pop()!;
    const manager = LOCKFILE_NAMES.find(([n]) => n === file)![1];
    let packages;
    try {
      packages = parseLockfile(manager, text);
    } catch {
      return {
        unused: new Set(),
        audit: {
          supported: false,
          manager,
          vulnerabilities: [],
          note: `${candidate} could not be read.`,
        },
      };
    }
    const found = await lookupAdvisories(packages, new Set(directDeps));
    return {
      unused: new Set(),
      audit: found.ok
        ? {
            supported: true,
            manager,
            vulnerabilities: found.vulnerabilities,
          }
        : { supported: false, manager, vulnerabilities: [], note: found.error },
    };
  }
  return null;
}

/**
 * Payload / Next.js / React / Node of a repository at a ref, for the
 * version overview: versions from the lockfile, Node from the Dockerfile,
 * .nvmrc or engines. A few API reads on the host, no clone.
 */
async function readStack(
  h: RepoHandle,
  ref: string,
  pathToPackageJson: string,
  pkg: Parameters<typeof buildStack>[0]
) {
  let locked = null;
  for (const candidate of lockfileCandidates(pathToPackageJson)) {
    const text = await fetchRepoText(h, ref, candidate);
    if (text == null) continue;
    const file = candidate.split("/").pop()!;
    const manager = LOCKFILE_NAMES.find(([n]) => n === file)![1];
    try {
      locked = parseLockfile(manager, text);
    } catch {
      locked = null;
    }
    break;
  }
  const dir = path.posix.dirname(pathToPackageJson);
  const inDirs = async (name: string) => {
    for (const d of dir === "." ? ["."] : [dir, "."]) {
      const text = await fetchRepoText(
        h,
        ref,
        d === "." ? name : `${d}/${name}`
      );
      if (text != null) return text;
    }
    return null;
  };
  return buildStack(pkg, locked, {
    dockerfile: await inDirs("Dockerfile"),
    nvmrc: (await inDirs(".nvmrc")) ?? (await inDirs(".node-version")),
  });
}

async function getLatestVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NPM_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${NPM_REGISTRY}/${encodeURIComponent(packageName)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data["dist-tags"]?.latest ?? data.version ?? null;
    return latest;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

function vulnKey(v: {
  ghsaId: string | null;
  packageName: string;
  severity: string;
}): string {
  return v.ghsaId ?? `${v.packageName}:${v.severity}`;
}

type ScanRepo = {
  id: string;
  organizationId: string;
  name: string;
  githubUrl: string;
  autoFixCritical: boolean;
};

/**
 * Post-scan security actions:
 *  1. Alert on critical/high CVEs that are NEW vs. the previous successful scan
 *     (so scheduled scans don't re-alert every run).
 *  2. If auto-fix is enabled and a fresh fixable critical/high exists, kick off
 *     the autonomous security-fix workflow (guarded against overlap).
 */
async function handleCriticalCves(
  repo: ScanRepo,
  scanId: string,
  vulns: Vulnerability[],
  manager: PackageManager
): Promise<void> {
  const criticalHigh = vulns.filter(
    (v) => v.severity === "critical" || v.severity === "high"
  );
  if (criticalHigh.length === 0) return;

  let previousKeys = new Set<string>();
  try {
    const prevScans = await db
      .select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.repositoryId, repo.id), eq(scans.status, "success")))
      .orderBy(desc(scans.startedAt));
    const prev = prevScans.find((s) => s.id !== scanId);
    if (prev) {
      const prevVulns = await db
        .select()
        .from(vulnerabilities)
        .where(eq(vulnerabilities.scanId, prev.id));
      previousKeys = new Set(prevVulns.map((v) => vulnKey(v)));
    }
  } catch {
    // If the diff query fails, fall through and alert on all (better than silence).
  }

  const fresh = criticalHigh.filter((v) => !previousKeys.has(vulnKey(v)));
  if (fresh.length === 0) return;

  const criticalN = fresh.filter((v) => v.severity === "critical").length;
  const highN = fresh.filter((v) => v.severity === "high").length;
  const lines = fresh
    .slice(0, 15)
    .map(
      (v) =>
        `• ${v.severity.toUpperCase()} ${v.packageName}${v.patchedVersion ? ` → ${v.patchedVersion}` : ""}${v.ghsaId ? ` (${v.ghsaId})` : ""}`
    );
  await notify(repo.organizationId, {
    type: "new_critical_cve",
    title: `${fresh.length} new vulnerabilit${fresh.length === 1 ? "y" : "ies"} in ${repo.name}`,
    message: [
      `${criticalN} critical, ${highN} high`,
      "",
      ...lines,
      fresh.length > 15 ? `…and ${fresh.length - 15} more` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    url: repo.githubUrl,
  }).catch(() => {});

  if (repo.autoFixCritical && fresh.some((v) => v.fixAvailable)) {
    // The fix flow is `npm audit fix`; starting it for a pnpm or yarn repo
    // would fail on every scan. The alert above still went out — only the
    // automated fix is skipped, and it is skipped quietly.
    if (manager !== "npm") {
      console.log(
        `[api] Auto-fix skipped for repo=${repo.id}: ${manager} repo (npm-only for now).`
      );
      return;
    }
    await maybeTriggerAutoFix(repo.id, scanId);
  }
}

/** Start an autonomous security fix unless one is already in flight. */
async function maybeTriggerAutoFix(
  repositoryId: string,
  scanId: string
): Promise<void> {
  try {
    const active = await db
      .select({ id: updateRuns.id })
      .from(updateRuns)
      .where(
        and(
          eq(updateRuns.repositoryId, repositoryId),
          eq(updateRuns.kind, "security"),
          inArray(updateRuns.status, [
            "created",
            "updating",
            "build_running",
            "deploying",
          ])
        )
      );
    if (active.length > 0) return; // one is already running

    const branchName = `security/cve-fix-${Date.now()}`;
    const [newRun] = await db
      .insert(updateRuns)
      .values({
        repositoryId,
        branchName,
        status: "created",
        kind: "security",
        scanId,
      })
      .returning();
    if (newRun) {
      console.log(
        `[api] Auto-fix triggered: repo=${repositoryId} run=${newRun.id}`
      );
      runSecurityFix(newRun.id).catch((e) =>
        console.error("[api] runSecurityFix error:", e)
      );
    }
  } catch (e) {
    console.error("[api] maybeTriggerAutoFix error:", e);
  }
}

/**
 * Scan a repository. By default that means the repository's branch — what the
 * code says today. With `commit`, it means that exact commit instead: the
 * version a deployment reports about itself, which is the only way to tell a
 * CVE that is fixed in the code from one that is fixed in production.
 */
/** How often a running scan proves it is alive (see scheduler). */
export const SCAN_HEARTBEAT_MS = 60_000;

export async function runScan(
  repositoryId: string,
  existingScanId?: string,
  /**
   * full: clone the repository, run the package manager's audit and find
   * unused dependencies — heavier, for a scan someone asked for. Otherwise
   * the lockfile is read through the GitHub API (see analyzeLockfile).
   */
  opts?: { commit?: string | null; full?: boolean }
): Promise<string | null> {
  console.log(
    `[api] runScan: repo=${repositoryId} scanId=${existingScanId ?? "(new)"}`
  );
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  if (!repo) {
    console.error("[api] runScan: repository not found");
    throw new Error("Repository not found");
  }
  const handle = await resolveRepo(repo.githubUrl, repo.organizationId);
  if (!handle) {
    if (existingScanId) {
      await db
        .update(scans)
        .set({
          status: "failed",
          errorMessage:
            "Not a repository URL on GitHub, GitLab, Bitbucket or a Git host set up under Settings",
          finishedAt: new Date(),
        })
        .where(eq(scans.id, existingScanId));
      return existingScanId;
    }
    const [failedScan] = await db
      .insert(scans)
      .values({ repositoryId, status: "pending" })
      .returning();
    if (failedScan) {
      await db
        .update(scans)
        .set({
          status: "failed",
          errorMessage:
            "Not a repository URL on GitHub, GitLab, Bitbucket or a Git host set up under Settings",
          finishedAt: new Date(),
        })
        .where(eq(scans.id, failedScan.id));
    }
    return null;
  }
  let scanId: string;
  if (existingScanId) {
    scanId = existingScanId;
  } else {
    const [scanRow] = await db
      .insert(scans)
      .values({
        repositoryId,
        status: "pending",
        target: opts?.commit ? "live" : "default",
        ref: opts?.commit ?? null,
      })
      .returning();
    if (!scanRow) return null;
    scanId = scanRow.id;
  }
  const branch = repo.defaultBranch || handle.branch;
  // Everything downstream takes a ref: every host's file API accepts a SHA
  // where a branch name goes, and the clone
  // fetches the commit directly.
  const commit = opts?.commit ?? null;
  const ref = commit ?? branch;
  const pathToPackageJson = repo.packageJsonPath || "package.json";
  // Proof of life: the scheduler retires scans whose heartbeat stopped.
  const beat = () =>
    db
      .update(scans)
      .set({ heartbeatAt: new Date() })
      .where(eq(scans.id, scanId))
      .catch(() => {});
  const heartbeat = setInterval(beat, SCAN_HEARTBEAT_MS);
  heartbeat.unref();
  try {
    await db
      .update(scans)
      .set({
        status: "running",
        heartbeatAt: new Date(),
        currentStep: "fetch_package_json",
        target: commit ? "live" : "default",
        ref,
      })
      .where(eq(scans.id, scanId));
    console.log(
      `[api] Scan ${scanId} running (repo ${repositoryId}, ref ${ref})`
    );
    const result = await fetchPackageJson(handle, ref, pathToPackageJson);
    if (!result.ok) {
      console.error(`[api] Scan ${scanId} failed: ${result.error}`);
      await db
        .update(scans)
        .set({
          status: "failed",
          errorMessage: result.error,
          finishedAt: new Date(),
        })
        .where(eq(scans.id, scanId));
      return scanId;
    }
    const pkg = result.pkg;
    // The version overview follows the branch, not a deployed commit.
    if (!commit) {
      void readStack(handle, ref, pathToPackageJson, pkg)
        .then((stack) =>
          db
            .update(repositories)
            .set({ stack })
            .where(eq(repositories.id, repositoryId))
        )
        .catch((e) => console.error(`[api] Scan ${scanId} stack:`, e));
    }
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const isDev = new Set(Object.keys(pkg.devDependencies ?? {}));
    const light = opts?.full
      ? null
      : await analyzeLockfile(
          handle,
          ref,
          pathToPackageJson,
          Object.keys(deps)
        );
    if (!light) {
      await db
        .update(scans)
        .set({ currentStep: "clone_depcheck" })
        .where(eq(scans.id, scanId));
    }
    if (light) {
      // Unused dependencies need a clone (depcheck reads the code): keep
      // what the last full scan found instead of forgetting it.
      const [lastFull] = await db
        .select({ id: scans.id })
        .from(scans)
        .innerJoin(packageFindings, eq(packageFindings.scanId, scans.id))
        .where(
          and(
            eq(scans.repositoryId, repositoryId),
            eq(scans.status, "success"),
            eq(packageFindings.unused, true)
          )
        )
        .orderBy(desc(scans.startedAt))
        .limit(1);
      if (lastFull) {
        const rows = await db
          .select({ name: packageFindings.packageName })
          .from(packageFindings)
          .where(
            and(
              eq(packageFindings.scanId, lastFull.id),
              eq(packageFindings.unused, true)
            )
          );
        light.unused = new Set(rows.map((r) => r.name));
      }
    }
    const { unused: unusedSet, audit } =
      light ??
      (await analyzeClone(
        handle,
        branch,
        pathToPackageJson,
        () => {
          void db
            .update(scans)
            .set({ currentStep: "audit" })
            .where(eq(scans.id, scanId));
        },
        commit
      ));
    if (audit.vulnerabilities.length > 0) {
      await db
        .insert(vulnerabilities)
        .values(audit.vulnerabilities.map((v) => ({ scanId, ...v })));
    }
    // Record why there is no vulnerability data, so the UI can say it instead
    // of showing an empty CVE table that looks like good news.
    if (!audit.supported) {
      const note = audit.note ?? `Audit did not run (${audit.manager}).`;
      console.log(`[api] Scan ${scanId} audit: ${note}`);
      await db
        .update(scans)
        .set({ auditNote: note })
        .where(eq(scans.id, scanId));
    }
    const depEntries = Object.entries(deps);
    const total = depEntries.length;
    let done = 0;
    const updateProgress = async (n: number) => {
      if (n % 10 === 0 || n === total) {
        console.log(`[api] Scan ${scanId} fetch_versions ${n}/${total}`);
        await db
          .update(scans)
          .set({ currentStep: `fetch_versions:${n}:${total}` })
          .where(eq(scans.id, scanId));
      }
    };
    if (total > 0) {
      await db
        .update(scans)
        .set({ currentStep: `fetch_versions:0:${total}` })
        .where(eq(scans.id, scanId));
    }
    const fetchVersionsPromise = Promise.all(
      depEntries.map(([name, range]) =>
        limit(async () => {
          const latest = await getLatestVersion(name);
          const n = ++done;
          await updateProgress(n);
          if (latest) {
            await db.insert(packageFindings).values({
              scanId,
              packageName: name,
              currentVersion: range.replace(/^[\^~]/, "").split("-")[0],
              latestVersion: latest,
              wantedVersion: range,
              isDevDependency: isDev.has(name),
              unused: unusedSet.has(name),
            });
          }
        })
      )
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Fetching latest versions timed out (5 min)")),
        FETCH_VERSIONS_PHASE_TIMEOUT_MS
      )
    );
    await Promise.race([fetchVersionsPromise, timeoutPromise]);
    await db
      .update(scans)
      .set({ status: "success", currentStep: null, finishedAt: new Date() })
      .where(eq(scans.id, scanId));
    console.log(`[api] Scan ${scanId} success`);
    // A scan of the deployed commit says nothing about the branch: it must not
    // reset the repo's scan clock, and an auto-fix belongs on the branch, not
    // on a commit that has already shipped. Both are skipped for live scans.
    if (!commit) {
      await db
        .update(repositories)
        .set({ lastScannedAt: new Date() })
        .where(eq(repositories.id, repositoryId));
      // Post-scan actions (best-effort): alert on new critical CVEs.
      // Phase 4/5 also hook the autonomous security-fix trigger here.
      await handleCriticalCves(
        repo,
        scanId,
        audit.vulnerabilities,
        audit.manager
      );
    }
    return scanId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    await db
      .update(scans)
      .set({
        status: "failed",
        currentStep: null,
        errorMessage: message,
        finishedAt: new Date(),
      })
      .where(eq(scans.id, scanId));
    console.log(`[api] Scan ${scanId} failed: ${message}`);
    return scanId;
  } finally {
    clearInterval(heartbeat);
  }
}
