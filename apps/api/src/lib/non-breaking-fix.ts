import semver from "semver";
import type { LockedPackage } from "./lockfile";

/** Whether dependency / devDependency ranges in package.json changed. */
export function declaredDepsChanged(
  before: Record<string, string>,
  after: Record<string, string>
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (before[k] !== after[k]) return true;
  }
  return false;
}

/**
 * Packages whose highest locked major rose after the fix. A within-major
 * security bump never does this; majors need a human.
 */
export function lockedMajorBumps(
  before: LockedPackage[],
  after: LockedPackage[]
): string[] {
  const maxMajor = (list: LockedPackage[], name: string): number => {
    let m = -1;
    for (const p of list) {
      if (p.name !== name) continue;
      const c = semver.coerce(p.version);
      if (c) m = Math.max(m, c.major);
    }
    return m;
  };
  const names = new Set(after.map((p) => p.name));
  const bumps: string[] = [];
  for (const name of names) {
    const b = maxMajor(before, name);
    const a = maxMajor(after, name);
    if (b >= 0 && a > b) bumps.push(`${name} ${b}→${a}`);
  }
  return bumps;
}

export type NonBreakingInput = {
  /** Diff only touches package.json / lockfiles. */
  onlyAllowedFiles: boolean;
  /** dependencies / devDependencies ranges unchanged. */
  declaredDepsUnchanged: boolean;
  /** Locked packages that crossed a major. */
  majorBumps: string[];
  /** audit fix --force (or pnpm allowMajor). */
  usedForce: boolean;
};

/** Gate for unattended merge + deploy: no force, no range edits, no majors. */
export function isNonBreakingSecurityChange(
  opts: NonBreakingInput
): { ok: true } | { ok: false; reason: string } {
  if (opts.usedForce) {
    return {
      ok: false,
      reason: "force / major upgrades were allowed — needs a human review",
    };
  }
  if (!opts.onlyAllowedFiles) {
    return {
      ok: false,
      reason: "diff touches files beyond package.json/lockfile",
    };
  }
  if (!opts.declaredDepsUnchanged) {
    return {
      ok: false,
      reason: "package.json dependency ranges changed",
    };
  }
  if (opts.majorBumps.length > 0) {
    return {
      ok: false,
      reason: `major version bumps in the lockfile: ${opts.majorBumps.slice(0, 5).join(", ")}`,
    };
  }
  return { ok: true };
}
