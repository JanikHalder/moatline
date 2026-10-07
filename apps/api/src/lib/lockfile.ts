import type { PackageManager } from "./package-manager";

/** One installed package: what the lockfile pins, nothing resolved here. */
export type LockedPackage = { name: string; version: string };

/** Lockfile names per manager, in the order they are looked for. */
export const LOCKFILE_NAMES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
];

const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.+-]*)?$/;

function dedupe(list: LockedPackage[]): LockedPackage[] {
  const seen = new Map<string, LockedPackage>();
  for (const p of list) {
    if (p.name && VERSION.test(p.version))
      seen.set(`${p.name}@${p.version}`, p);
  }
  return [...seen.values()];
}

/** "name@1.2.3" or "@scope/name@1.2.3" → parts; null when not that shape. */
function splitAt(spec: string): { name: string; rest: string } | null {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  if (at <= 0) return null;
  return { name: spec.slice(0, at), rest: spec.slice(at + 1) };
}

/** package-lock.json v1 (nested `dependencies`) and v2/v3 (flat `packages`). */
export function parsePackageLock(text: string): LockedPackage[] {
  const lock = JSON.parse(text) as {
    packages?: Record<
      string,
      { name?: string; version?: string; link?: boolean }
    >;
    dependencies?: Record<string, unknown>;
  };
  const out: LockedPackage[] = [];
  if (lock.packages) {
    for (const [key, v] of Object.entries(lock.packages)) {
      if (!key || v.link || !v.version) continue;
      const i = key.lastIndexOf("node_modules/");
      // Workspace packages ("apps/web") are the project itself.
      if (i < 0) continue;
      out.push({
        name: v.name ?? key.slice(i + "node_modules/".length),
        version: v.version,
      });
    }
  } else if (lock.dependencies) {
    const walk = (deps: Record<string, unknown>) => {
      for (const [name, raw] of Object.entries(deps)) {
        const d = raw as {
          version?: string;
          dependencies?: Record<string, unknown>;
        };
        if (d.version) out.push({ name, version: d.version });
        if (d.dependencies) walk(d.dependencies);
      }
    };
    walk(lock.dependencies);
  }
  return dedupe(out);
}

/**
 * pnpm-lock.yaml v5–v9, read line by line (no YAML parser for a file that
 * can be megabytes): the keys of the `packages:` section are the installed
 * packages — "/name/1.2.3" (v5), "/name@1.2.3(peer…)" (v6), "name@1.2.3" (v9).
 */
export function parsePnpmLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const m = line.match(/^ {2}['"]?([^'"\s][^'"]*?)['"]?:\s*$/);
    if (!m) continue;
    let key = m[1]!.replace(/^\//, "");
    key = key.replace(/\(.*$/, ""); // peer suffix
    const parts = splitAt(key);
    if (parts && VERSION.test(parts.rest.replace(/_.*$/, ""))) {
      out.push({ name: parts.name, version: parts.rest.replace(/_.*$/, "") });
      continue;
    }
    // v5: "name/1.2.3" or "@scope/name/1.2.3_peer"
    const slash = key.lastIndexOf("/");
    if (slash > 0) {
      out.push({
        name: key.slice(0, slash),
        version: key.slice(slash + 1).replace(/_.*$/, ""),
      });
    }
  }
  return dedupe(out);
}

/** yarn.lock v1 and berry: a header of specs, then a `version` line. */
export function parseYarnLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let names: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\S.*:\s*$/.test(line) && !line.startsWith("#")) {
      names = [];
      if (line.startsWith("__metadata")) continue;
      for (const raw of line.replace(/:\s*$/, "").split(/,\s*/)) {
        const spec = raw.trim().replace(/^"|"$/g, "");
        if (/@(workspace|link|portal|file):/.test(spec)) continue;
        const parts = splitAt(spec);
        if (parts) names.push(parts.name);
      }
      continue;
    }
    const v = line.match(/^\s+version:?\s+"?([^"\s]+)"?\s*$/);
    if (v && names.length) {
      for (const name of new Set(names)) out.push({ name, version: v[1]! });
      names = [];
    }
  }
  return dedupe(out);
}

export function parseLockfile(
  manager: PackageManager,
  text: string
): LockedPackage[] {
  if (manager === "pnpm") return parsePnpmLock(text);
  if (manager === "yarn") return parseYarnLock(text);
  return parsePackageLock(text);
}

/**
 * Where a lockfile can sit for a package.json: next to it, or at a
 * workspace root above it. Nearest first.
 */
export function lockfileCandidates(packageJsonPath: string): string[] {
  const dirs: string[] = [];
  let dir = packageJsonPath
    .replace(/^\/+/, "")
    .replace(/\/?package\.json$/, "");
  for (;;) {
    dirs.push(dir);
    if (!dir) break;
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
  return dirs.flatMap((d) =>
    LOCKFILE_NAMES.map(([name]) => (d ? `${d}/${name}` : name))
  );
}
