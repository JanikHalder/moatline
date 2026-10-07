import fs from "node:fs";
import path from "node:path";
import type { PackageManager } from "./package-manager";
import type { Vulnerability } from "./audit";

const LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

/**
 * Where the lockfile lives, and whose it is. In a pnpm or yarn workspace the
 * lockfile sits at the workspace root, not next to the package being fixed —
 * looking only in the package directory would mistake a pnpm monorepo for
 * an npm project. Walks up from `projectDir`, never above `rootDir`.
 */
export function findLockfile(
  projectDir: string,
  rootDir: string
): { dir: string; manager: PackageManager } | null {
  const root = path.resolve(rootDir);
  let dir = path.resolve(projectDir);
  for (;;) {
    for (const [file, manager] of LOCKFILES) {
      if (fs.existsSync(path.join(dir, file))) return { dir, manager };
    }
    if (dir === root || !dir.startsWith(root)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** ">=1.2.3" → "^1.2.3"; anything else unchanged. */
export function caretize(range: string): string {
  const m = range.trim().match(/^>=\s*(\d+\.\d+\.\d+[^\s|<>]*)$/);
  return m ? `^${m[1]}` : range;
}

/**
 * `pnpm audit --fix` writes overrides like `"pkg@<2.0.1": ">=2.0.1"`, which
 * resolves to the newest release — possibly a new major. Pin each to the
 * patched version's major instead, so a security fix cannot become a
 * breaking upgrade. Returns how many overrides were tightened.
 */
export function tightenPackageJsonOverrides(pkgPath: string): number {
  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as {
    pnpm?: { overrides?: Record<string, string> };
  };
  const overrides = pkg.pnpm?.overrides;
  if (!overrides) return 0;
  let changed = 0;
  for (const [k, v] of Object.entries(overrides)) {
    const next = caretize(v);
    if (next !== v) {
      overrides[k] = next;
      changed++;
    }
  }
  if (changed) {
    const indent = raw.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(pkg, null, indent) + (raw.endsWith("\n") ? "\n" : "")
    );
  }
  return changed;
}

/** The same for `overrides:` in pnpm-workspace.yaml (pnpm 10 writes there). */
export function tightenWorkspaceOverrides(yamlPath: string): number {
  if (!fs.existsSync(yamlPath)) return 0;
  const lines = fs.readFileSync(yamlPath, "utf8").split("\n");
  let inOverrides = false;
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^overrides:\s*$/.test(line)) {
      inOverrides = true;
      continue;
    }
    if (inOverrides && /^\S/.test(line)) inOverrides = false;
    if (!inOverrides) continue;
    const next = line.replace(
      /(:\s*)(['"]?)>=\s*(\d+\.\d+\.\d+[^\s'"|<>]*)\2\s*$/,
      (_m, sep: string, q: string, v: string) => `${sep}${q}^${v}${q}`
    );
    if (next !== line) {
      lines[i] = next;
      changed++;
    }
  }
  if (changed) fs.writeFileSync(yamlPath, lines.join("\n"));
  return changed;
}

/**
 * Yarn has no `audit fix`. The equivalent is a `resolutions` entry per
 * vulnerable package, pinned to the patched version's major. Only packages
 * the audit reports a fixed version for are touched.
 */
export function yarnResolutions(
  vulns: Vulnerability[]
): Record<string, string> {
  const best = new Map<string, number[]>();
  const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
  const newer = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    }
    return false;
  };
  for (const v of vulns) {
    const m = v.patchedVersion?.match(/(\d+\.\d+\.\d+)/);
    if (!v.fixAvailable || !m) continue;
    const version = parse(m[1]!);
    const prev = best.get(v.packageName);
    if (!prev || newer(version, prev)) best.set(v.packageName, version);
  }
  const out: Record<string, string> = {};
  for (const [name, v] of best) out[name] = `^${v.join(".")}`;
  return out;
}

export function applyYarnResolutions(
  pkgPath: string,
  resolutions: Record<string, string>
): number {
  if (Object.keys(resolutions).length === 0) return 0;
  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as { resolutions?: Record<string, string> };
  pkg.resolutions = { ...(pkg.resolutions ?? {}), ...resolutions };
  const indent = raw.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  fs.writeFileSync(
    pkgPath,
    JSON.stringify(pkg, null, indent) + (raw.endsWith("\n") ? "\n" : "")
  );
  return Object.keys(resolutions).length;
}

/** The commands a package manager uses for each step of the fix. */
export function managerCommands(manager: PackageManager): {
  install: [string, string[]];
  build: [string, string[]];
  test: [string, string[]];
  fixLabel: string;
} {
  switch (manager) {
    case "pnpm":
      return {
        install: ["pnpm", ["install", "--no-frozen-lockfile"]],
        build: ["pnpm", ["run", "build"]],
        test: ["pnpm", ["test"]],
        fixLabel: "pnpm audit --fix",
      };
    case "yarn":
      return {
        install: ["yarn", ["install"]],
        build: ["yarn", ["run", "build"]],
        test: ["yarn", ["test"]],
        fixLabel: "yarn resolutions",
      };
    default:
      return {
        install: ["npm", ["install", "--no-audit", "--no-fund"]],
        build: ["npm", ["run", "build"]],
        test: ["npm", ["test"]],
        fixLabel: "npm audit fix",
      };
  }
}
