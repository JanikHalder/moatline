import { eq } from "drizzle-orm";
import { db, orgIntegrations } from "db";
import { decryptSecret, isEncrypted } from "./crypto";
import { installationFor, installationToken } from "./github-app";

const plain = (v: string) => (isEncrypted(v) ? decryptSecret(v) : v);

async function integration(organizationId: string) {
  const [row] = await db
    .select({
      githubToken: orgIntegrations.githubToken,
      githubApp: orgIntegrations.githubApp,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId))
    .limit(1);
  return row;
}

/**
 * The organization's personal token, else `GITHUB_TOKEN` — for what only a
 * user can do (list their repositories, create one from a template).
 */
export async function getGithubUserToken(
  organizationId: string | null | undefined
): Promise<string | null> {
  const envToken = process.env.GITHUB_TOKEN?.trim() || null;
  if (!organizationId) return envToken;
  try {
    const stored = (await integration(organizationId))?.githubToken;
    if (stored) return plain(stored);
  } catch (e) {
    console.error(
      "[github] Could not read the organization's GitHub token, falling back to GITHUB_TOKEN:",
      e
    );
  }
  return envToken;
}

/**
 * Resolve the GitHub token to use for an organization's repository.
 *
 * The organization's GitHub App wins when it is installed on the
 * repository's owner (or on exactly one account, when no owner is given):
 * a token that lasts an hour. Then the organization's own token, so several
 * agencies or clients can live on one instance without sharing access, and
 * `GITHUB_TOKEN` as the instance-wide fallback.
 *
 * Returns null when nothing is configured — callers then work with public
 * repositories only.
 */
export async function getGithubToken(
  organizationId: string | null | undefined,
  owner?: string | null
): Promise<string | null> {
  if (organizationId) {
    try {
      const app = (await integration(organizationId))?.githubApp;
      const inst = app ? installationFor(app.installations, owner) : null;
      if (app && inst) {
        const token = await installationToken(
          { id: app.id, privateKey: plain(app.privateKey) },
          inst.id
        );
        if (token) return token;
      }
    } catch (e) {
      console.error("[github] GitHub App token failed:", e);
    }
  }
  return getGithubUserToken(organizationId);
}
