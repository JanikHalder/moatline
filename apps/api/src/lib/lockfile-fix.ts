import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import type { AuditResult, Vulnerability } from "./audit";
import { lookupAdvisories } from "./advisories";
import { LOCKFILE_NAMES, parseLockfile, type LockedPackage } from "./lockfile";
import type { PackageManager } from "./package-manager";
import { familyOf, misaligned, type Family } from "./lockstep";

/**
 * The audit of a checked-out lockfile, without node_modules: the exact
 * versions it pins, looked up in the advisory database (see lookupAdvisories).
 */
export async function auditLockfile(
  workDir: string,
  manager: PackageManager,
  direct: Set<string>
): Promise<AuditResult & { packages: LockedPackage[] }> {
  const name = LOCKFILE_NAMES.find(([, m]) => m === manager)![0];
  const file = path.join(workDir, name);
  if (!fs.existsSync(file)) {
    return {
      supported: false,
      manager,
      vulnerabilities: [],
      packages: [],
      note: `No ${name} to audit.`,
    };
  }
  let packages: LockedPackage[];
  try {
    packages = parseLockfile(manager, fs.readFileSync(file, "utf8"));
  } catch {
    return {
      supported: false,
      manager,
      vulnerabilities: [],
      packages: [],
      note: `${name} could not be read.`,
    };
  }
  const found = await lookupAdvisories(packages, direct);
  return found.ok
    ? {
        supported: true,
        manager,
        vulnerabilities: found.vulnerabilities,
        packages,
      }
    : {
        supported: false,
        manager,
        vulnerabilities: [],
        packages,
        note: found.error,
      };
}

/**
 * pnpm overrides for the vulnerable versions, in the shape `pnpm audit --fix`
 * writes them ("pkg@<vulnerable range>": "^patched"), but only where the fix
 * stays within the installed major — unless majors are allowed.
 *
 * Packages released together (Payload, React, Lexical, Next.js) move as one:
 * every member is pinned to the same, smallest fixed version. Fixing only
 * `payload` and leaving `@payloadcms/ui` behind is a build that refuses to
 * start.
 */
export function pnpmOverrides(
  vulns: Vulnerability[],
  installed: LockedPackage[],
  allowMajor: boolean,
  declared: string[] = []
): { overrides: Record<string, string>; skipped: string[] } {
  const overrides: Record<string, string> = {};
  const skipped: string[] = [];
  const familyTarget = new Map<Family, string>();
  for (const v of vulns) {
    if (!v.patchedVersion || !v.vulnerableRange) {
      skipped.push(`${v.packageName} (no fixed version yet)`);
      continue;
    }
    const hit = installed.filter(
      (p) =>
        p.name === v.packageName &&
        semver.satisfies(p.version, v.vulnerableRange!, {
          includePrerelease: true,
        })
    );
    const major = semver.major(v.patchedVersion);
    if (!allowMajor && hit.some((p) => semver.major(p.version) !== major)) {
      skipped.push(
        `${v.packageName} ${hit.map((p) => p.version).join(", ")} (fix only in ${v.patchedVersion} — a major upgrade)`
      );
      continue;
    }
    const family = familyOf(v.packageName);
    if (family && declared.includes(family.leader)) {
      const prev = familyTarget.get(family);
      if (!prev || semver.gt(v.patchedVersion, prev))
        familyTarget.set(family, v.patchedVersion);
      continue;
    }
    overrides[`${v.packageName}@${v.vulnerableRange}`] = `^${v.patchedVersion}`;
  }
  for (const [family, fixed] of familyTarget) {
    // Never below what is already locked: the leader's newest copy wins.
    const locked = installed
      .filter((p) => p.name === family.leader)
      .map((p) => p.version);
    const target = [fixed, ...locked].sort(semver.rcompare)[0]!;
    for (const name of new Set(
      installed.filter((p) => family.member(p.name)).map((p) => p.name)
    )) {
      if (!family.wholeTree && !declared.includes(name)) continue;
      overrides[name] = target;
    }
  }
  return { overrides, skipped: [...new Set(skipped)] };
}

/**
 * Add overrides where this pnpm reads them: pnpm-workspace.yaml when it
 * already keeps overrides there (pnpm 10), otherwise package.json
 * `pnpm.overrides`. Existing entries are kept.
 */
export function applyPnpmOverrides(
  workDir: string,
  overrides: Record<string, string>
): number {
  const entries = Object.entries(overrides);
  if (!entries.length) return 0;
  const yamlPath = path.join(workDir, "pnpm-workspace.yaml");
  const yaml = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, "utf8") : "";
  if (/^overrides:\s*$/m.test(yaml)) {
    const lines = entries
      .filter(([k]) => !yaml.includes(`'${k}'`) && !yaml.includes(`"${k}"`))
      .map(([k, v]) => `  '${k}': '${v}'`);
    fs.writeFileSync(
      yamlPath,
      yaml.replace(/^overrides:\s*$/m, (m) => `${m}\n${lines.join("\n")}`)
    );
    return lines.length;
  }
  const pkgPath = path.join(workDir, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as {
    pnpm?: { overrides?: Record<string, string> };
  };
  pkg.pnpm = {
    ...pkg.pnpm,
    overrides: { ...pkg.pnpm?.overrides, ...overrides },
  };
  const indent = raw.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  fs.writeFileSync(
    pkgPath,
    JSON.stringify(pkg, null, indent) + (raw.endsWith("\n") ? "\n" : "")
  );
  return entries.length;
}

/** Yarn 2+ (berry) can update its lockfile without installing anything. */
export function isYarnBerry(workDir: string): boolean {
  if (fs.existsSync(path.join(workDir, ".yarnrc.yml"))) return true;
  const lock = path.join(workDir, "yarn.lock");
  return (
    fs.existsSync(lock) &&
    fs.readFileSync(lock, "utf8").slice(0, 2000).includes("__metadata:")
  );
}

/**
 * Re-resolve the lockfile after package.json changed, without downloading
 * packages or running their scripts. Yarn 1 has no such mode: it installs.
 */
export function relockCommand(
  manager: PackageManager,
  workDir: string
): [string, string[]] {
  if (manager === "pnpm")
    return [
      "pnpm",
      [
        "install",
        "--lockfile-only",
        "--ignore-scripts",
        "--no-frozen-lockfile",
      ],
    ];
  if (manager === "yarn")
    return isYarnBerry(workDir)
      ? ["yarn", ["install", "--mode=update-lockfile"]]
      : ["yarn", ["install", "--ignore-scripts", "--no-progress"]];
  return [
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
  ];
}

/** Package-manager-specific way to force versions across the whole tree. */
export function applyPins(
  workDir: string,
  manager: PackageManager,
  pins: Record<string, string>
): number {
  if (!Object.keys(pins).length) return 0;
  if (manager === "pnpm") return applyPnpmOverrides(workDir, pins);
  const pkgPath = path.join(workDir, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const key = manager === "yarn" ? "resolutions" : "overrides";
  pkg[key] = { ...(pkg[key] as Record<string, string> | undefined), ...pins };
  const indent = raw.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  fs.writeFileSync(
    pkgPath,
    JSON.stringify(pkg, null, indent) + (raw.endsWith("\n") ? "\n" : "")
  );
  return Object.keys(pins).length;
}

/**
 * Repair packages released together that ended up at different versions
 * (an update moved `payload` but a plugin pins an older `@payloadcms/ui`):
 * pin every member to its leader's version and re-resolve the lockfile —
 * no install. Returns what was pinned; empty when everything matched.
 */
export async function alignLockedFamilies(
  workDir: string,
  manager: PackageManager,
  declared: string[],
  run: (
    cmd: string,
    args: string[]
  ) => Promise<{ ok: boolean; stdout: string; stderr: string }>
): Promise<{ pinned: Record<string, string>; ok: boolean; output: string }> {
  const name = LOCKFILE_NAMES.find(([, m]) => m === manager)![0];
  const file = path.join(workDir, name);
  if (!fs.existsSync(file)) return { pinned: {}, ok: true, output: "" };
  const { leaders, off } = misaligned(
    parseLockfile(manager, fs.readFileSync(file, "utf8")),
    declared
  );
  const pinned: Record<string, string> = {};
  for (const m of off) pinned[m.name] = m.target;
  // Two copies of the leader itself: one version for the whole tree.
  for (const [family, versions] of leaders)
    if (versions.length > 1 && family.wholeTree)
      pinned[family.leader] = versions[0]!;
  if (!Object.keys(pinned).length) return { pinned, ok: true, output: "" };
  applyPins(workDir, manager, pinned);
  const [cmd, args] = relockCommand(manager, workDir);
  const res = await run(cmd, args);
  return { pinned, ok: res.ok, output: `${res.stdout}\n${res.stderr}`.trim() };
}
