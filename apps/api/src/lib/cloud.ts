/**
 * The hosted service (CLOUD_MODE=true) differs from a self-hosted instance
 * in who signs up and whose code it handles: anyone may register, and the
 * repositories belong to strangers. A self-hosted instance trusts its users
 * and their repositories; the cloud trusts neither.
 *
 * - Sign-up is open (and confirmed by email when the system can send one).
 * - Code from a repository is never executed here: no typecheck, no build,
 *   no tests — the repository's own CI checks a fix. Package managers run
 *   without lifecycle scripts, pnpmfiles or a repository's yarn release.
 */
export function isCloud(): boolean {
  return process.env.CLOUD_MODE === "true";
}

export type VerifyMode = "typecheck" | "build" | "none";

/**
 * How a fix or update is checked before its pull request. "typecheck" runs
 * the repository's own tsc and "build" its build — both execute code from
 * the repository, so the cloud leaves the check to the repository's CI.
 */
export function effectiveVerifyMode(mode: VerifyMode | null): VerifyMode {
  if (isCloud()) return "none";
  return mode ?? "typecheck";
}

/**
 * Organizations that use the cloud without a subscription — the operator's
 * own, for instance. Ids or slugs, comma-separated: BILLING_FREE_ORGS.
 */
export function isBillingExempt(org: { id: string; slug?: string | null }) {
  const list = (process.env.BILLING_FREE_ORGS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(org.id) || (!!org.slug && list.includes(org.slug));
}

/**
 * Environment for package managers working on a stranger's repository in
 * the cloud: no lifecycle scripts, no .pnpmfile.cjs, and no .yarnrc.yml —
 * which could point at a yarn release or plugins shipped in the repository.
 */
export function untrustedRepoEnv(): Record<string, string> {
  if (!isCloud()) return {};
  return {
    npm_config_ignore_scripts: "true",
    npm_config_ignore_pnpmfile: "true",
    YARN_ENABLE_SCRIPTS: "false",
    YARN_IGNORE_PATH: "1",
    YARN_RC_FILENAME: ".moatline-no-yarnrc.yml",
  };
}
