import semver from "semver";
import type { LockedPackage } from "./lockfile";

/** The packages the version overview shows, by their leader package. */
export const STACK_PACKAGES = ["payload", "next", "react"] as const;
export type StackPackage = (typeof STACK_PACKAGES)[number];

export type Stack = {
  packages: Partial<
    Record<StackPackage, { declared: string | null; installed: string | null }>
  >;
  /** The Node.js the app runs on, and where that was read. */
  node: { version: string; source: "Dockerfile" | ".nvmrc" | "engines" } | null;
  at: string;
};

/** Highest locked version of a package — Payload checks every copy anyway. */
export function installedVersion(
  locked: LockedPackage[] | null,
  name: string
): string | null {
  const versions = (locked ?? [])
    .filter((p) => p.name === name && semver.valid(p.version))
    .map((p) => p.version);
  return versions.length ? semver.rsort(versions)[0]! : null;
}

/**
 * The Node.js version, most reliable first: the Dockerfile's base image is
 * what actually runs; .nvmrc and engines are what developers meant.
 */
export function nodeVersion(sources: {
  dockerfile?: string | null;
  nvmrc?: string | null;
  engines?: string | null;
}): Stack["node"] {
  const from = sources.dockerfile?.match(
    /^\s*FROM\s+(?:--platform=\S+\s+)?(?:docker\.io\/)?(?:library\/)?node:(\d+(?:\.\d+){0,2})/im
  );
  if (from) return { version: from[1]!, source: "Dockerfile" };
  const nvm = sources.nvmrc?.trim().match(/^v?(\d+(?:\.\d+){0,2})$/);
  if (nvm) return { version: nvm[1]!, source: ".nvmrc" };
  const min = sources.engines ? semver.minVersion(sources.engines) : null;
  if (min) return { version: String(min.major), source: "engines" };
  return null;
}

export function buildStack(
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: { node?: string };
  },
  locked: LockedPackage[] | null,
  files: { dockerfile?: string | null; nvmrc?: string | null },
  now = new Date()
): Stack {
  const all = { ...pkg.devDependencies, ...pkg.dependencies };
  const packages: Stack["packages"] = {};
  for (const name of STACK_PACKAGES) {
    const declared = all[name] ?? null;
    const installed = installedVersion(locked, name);
    if (declared || installed) packages[name] = { declared, installed };
  }
  return {
    packages,
    node: nodeVersion({ ...files, engines: pkg.engines?.node ?? null }),
    at: now.toISOString(),
  };
}

/** Version actually in use: the lockfile's, else the declared range's floor. */
export function effectiveVersion(
  p: { declared: string | null; installed: string | null } | undefined
): string | null {
  if (!p) return null;
  if (p.installed) return p.installed;
  const min = p.declared ? semver.minVersion(p.declared) : null;
  return min ? min.version : null;
}

/** End of life of each Node.js major (nodejs.org/en/about/previous-releases). */
export const NODE_EOL: Record<number, string> = {
  16: "2023-09-11",
  17: "2022-06-01",
  18: "2025-04-30",
  19: "2023-06-01",
  20: "2026-04-30",
  21: "2024-06-01",
  22: "2027-04-30",
  23: "2025-06-01",
  24: "2028-04-30",
  25: "2026-06-01",
  26: "2029-04-30",
};

/** "eol" past end of life, "soon" within six months, else "ok". */
export function nodeSupport(
  version: string,
  now = Date.now()
): "eol" | "soon" | "ok" | "unknown" {
  const major = Number.parseInt(version, 10);
  const eol = NODE_EOL[major];
  if (!eol) return major < 16 ? "eol" : "unknown";
  const left = Date.parse(eol) - now;
  return left < 0 ? "eol" : left < 183 * 24 * 60 * 60 * 1000 ? "soon" : "ok";
}
