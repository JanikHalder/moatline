import type { Vulnerability } from "./api";

/**
 * The difference between what the code says and what is actually running.
 *
 * A scan of the branch answers "is it fixed?", which is not the question a
 * security report is asked. `fixedNotDeployed` is the gap that matters: the
 * fix exists, the vulnerability is still being served.
 */
export type LiveGap = {
  /** Vulnerable at the deployed commit, gone on the branch — fix not shipped. */
  fixedNotDeployed: Vulnerability[];
  /** Vulnerable in both — no fix yet, and production is exposed. */
  stillOpen: Vulnerability[];
  /** On the branch only — introduced after the deployed commit was built. */
  newSinceDeploy: Vulnerability[];
};

/**
 * Advisory identity. GHSA ids are stable and per-advisory; when one is missing
 * the package plus the CVE (or, failing that, the title) is the closest thing
 * to it — severity alone would merge unrelated findings.
 */
function key(v: Vulnerability): string {
  if (v.ghsaId) return `ghsa:${v.ghsaId}`;
  if (v.cveId) return `${v.packageName}:${v.cveId}`;
  return `${v.packageName}:${v.title ?? v.severity}`;
}

export function compareVulnerabilities(
  live: Vulnerability[],
  branch: Vulnerability[]
): LiveGap {
  const branchKeys = new Set(branch.map(key));
  const liveKeys = new Set(live.map(key));
  return {
    fixedNotDeployed: live.filter((v) => !branchKeys.has(key(v))),
    stillOpen: live.filter((v) => branchKeys.has(key(v))),
    newSinceDeploy: branch.filter((v) => !liveKeys.has(key(v))),
  };
}
