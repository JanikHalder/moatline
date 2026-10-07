import { and, eq, isNotNull, or } from "drizzle-orm";
import { db, orgIntegrations, repositories } from "db";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { loadGitHosts, repoKey } from "../lib/git-host";
import {
  listKomodo,
  type KomodoConfig,
  type KomodoResource,
} from "../lib/komodo";
import {
  listPortainerStacks,
  type PortainerConfig,
  type PortainerStack,
} from "../lib/portainer";
import { hasDeployTarget } from "./platforms";

/**
 * Komodo and Portainer: platforms that run stacks from a Git repository.
 * Their credentials, a short cache of what they run, and linking
 * repositories to the stack that deploys them.
 */

const plain = (v: string | null | undefined) => {
  if (!v) return null;
  try {
    return isEncrypted(v) ? decryptSecret(v) : v;
  } catch {
    return null;
  }
};

async function integrations(organizationId: string) {
  const [row] = await db
    .select({
      komodoBaseUrl: orgIntegrations.komodoBaseUrl,
      komodoApiKey: orgIntegrations.komodoApiKey,
      komodoApiSecret: orgIntegrations.komodoApiSecret,
      portainerBaseUrl: orgIntegrations.portainerBaseUrl,
      portainerToken: orgIntegrations.portainerToken,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId));
  return row;
}

export async function resolveKomodoConfig(
  organizationId: string
): Promise<{ ok: true; config: KomodoConfig } | { ok: false; error: string }> {
  const row = await integrations(organizationId);
  const key = plain(row?.komodoApiKey);
  const secret = plain(row?.komodoApiSecret);
  if (!row?.komodoBaseUrl || !key || !secret)
    return {
      ok: false,
      error: "Komodo is not configured for this organization.",
    };
  return { ok: true, config: { baseUrl: row.komodoBaseUrl, key, secret } };
}

export async function resolvePortainerConfig(
  organizationId: string
): Promise<
  { ok: true; config: PortainerConfig } | { ok: false; error: string }
> {
  const row = await integrations(organizationId);
  const token = plain(row?.portainerToken);
  if (!row?.portainerBaseUrl || !token)
    return {
      ok: false,
      error: "Portainer is not configured for this organization.",
    };
  return { ok: true, config: { baseUrl: row.portainerBaseUrl, token } };
}

const TTL_MS = 5 * 60 * 1000;
const komodoCache = new Map<string, { at: number; list: KomodoResource[] }>();
const portainerCache = new Map<
  string,
  { at: number; list: PortainerStack[] }
>();

export async function komodoResources(
  organizationId: string,
  fresh = false
): Promise<
  { ok: true; list: KomodoResource[] } | { ok: false; error: string }
> {
  const hit = komodoCache.get(organizationId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS)
    return { ok: true, list: hit.list };
  const cfg = await resolveKomodoConfig(organizationId);
  if (!cfg.ok) return cfg;
  const r = await listKomodo(cfg.config);
  if (!r.ok) return r;
  komodoCache.set(organizationId, { at: Date.now(), list: r.data });
  return { ok: true, list: r.data };
}

export async function portainerStacks(
  organizationId: string,
  fresh = false
): Promise<
  { ok: true; list: PortainerStack[] } | { ok: false; error: string }
> {
  const hit = portainerCache.get(organizationId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS)
    return { ok: true, list: hit.list };
  const cfg = await resolvePortainerConfig(organizationId);
  if (!cfg.ok) return cfg;
  const r = await listPortainerStacks(cfg.config);
  if (!r.ok) return r;
  portainerCache.set(organizationId, { at: Date.now(), list: r.data });
  return { ok: true, list: r.data };
}

/** A stack that deploys from Git, whatever the platform. */
export type GitStack = {
  platform: "komodo" | "portainer";
  id: string;
  name: string;
  repoUrl: string | null;
  branch: string | null;
};

/** Every Git-deployed stack of the connected platforms (for the picker). */
export async function gitStacks(organizationId: string): Promise<GitStack[]> {
  const [k, p] = await Promise.all([
    komodoResources(organizationId).catch(() => null),
    portainerStacks(organizationId).catch(() => null),
  ]);
  return [
    ...(k?.ok ? k.list : [])
      .filter((r) => r.kind === "stack")
      .map((r) => ({
        platform: "komodo" as const,
        id: r.id,
        name: r.name,
        repoUrl: r.repoUrl,
        branch: r.branch,
      })),
    ...(p?.ok ? p.list : []).map((s) => ({
      platform: "portainer" as const,
      id: s.id,
      name: s.name,
      repoUrl: s.repoUrl,
      branch: s.branch,
    })),
  ];
}

/**
 * The stack that deploys a repository: same repository (on any Git host),
 * the same branch when several. Ambiguous → none; the user picks.
 */
export function matchStack<T extends GitStack>(
  repo: { githubUrl: string; defaultBranch: string },
  stacks: T[],
  hosts: Parameters<typeof repoKey>[1] = []
): T | null {
  const key = repoKey(repo.githubUrl, hosts);
  if (!key) return null;
  const same = stacks.filter(
    (s) => s.repoUrl && repoKey(s.repoUrl, hosts) === key
  );
  const onBranch = same.filter((s) => s.branch === repo.defaultBranch);
  const pick = onBranch.length ? onBranch : same;
  return pick.length === 1 ? pick[0]! : null;
}

/**
 * Link repositories without a platform to the Komodo or Portainer stack
 * that deploys them. Links set by hand and other platforms are left alone.
 */
export async function syncStacksForOrg(
  organizationId: string
): Promise<{ linked: number }> {
  await Promise.all([
    komodoResources(organizationId, true).catch(() => null),
    portainerStacks(organizationId, true).catch(() => null),
  ]);
  const stacks = await gitStacks(organizationId);
  if (!stacks.length) return { linked: 0 };
  const hosts = await loadGitHosts(organizationId);
  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));
  let linked = 0;
  for (const repo of repos) {
    if (hasDeployTarget(repo)) continue;
    const s = matchStack(repo, stacks, hosts);
    if (!s) continue;
    linked++;
    await db
      .update(repositories)
      .set({ platformKind: s.platform, platformAppId: s.id })
      .where(eq(repositories.id, repo.id));
  }
  return { linked };
}

const INTERVAL_MS = 15 * 60 * 1000;
const lastRun = new Map<string, number>();

export async function syncDueStacks(): Promise<void> {
  const orgs = await db
    .select({ organizationId: orgIntegrations.organizationId })
    .from(orgIntegrations)
    .where(
      or(
        and(
          isNotNull(orgIntegrations.komodoBaseUrl),
          isNotNull(orgIntegrations.komodoApiKey)
        ),
        and(
          isNotNull(orgIntegrations.portainerBaseUrl),
          isNotNull(orgIntegrations.portainerToken)
        )
      )
    );
  for (const o of orgs) {
    const last = lastRun.get(o.organizationId);
    if (last && Date.now() - last < INTERVAL_MS) continue;
    lastRun.set(o.organizationId, Date.now());
    await syncStacksForOrg(o.organizationId).catch((e) =>
      console.error("[stacks] sync failed:", e)
    );
  }
}

/** Forget cached lists, e.g. after the credentials changed. */
export function forgetStacks(organizationId: string): void {
  komodoCache.delete(organizationId);
  portainerCache.delete(organizationId);
}
