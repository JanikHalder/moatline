import { and, eq, isNotNull } from "drizzle-orm";
import { db, orgIntegrations, repositories, servers } from "db";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import {
  listResources,
  resourceOfContainer,
  type CoolifyConfig,
  type CoolifyResource,
} from "../lib/coolify";
import { githubRepoOfUrl } from "../lib/dokploy";
import { validateLiveUrl } from "../lib/live-check";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";
import { hasDeployTarget } from "./platforms";

export async function resolveCoolifyConfig(
  organizationId: string
): Promise<{ ok: true; config: CoolifyConfig } | { ok: false; error: string }> {
  const [integ] = await db
    .select({
      baseUrl: orgIntegrations.coolifyBaseUrl,
      token: orgIntegrations.coolifyToken,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId));
  if (!integ?.baseUrl || !integ.token)
    return {
      ok: false,
      error: "Coolify is not configured for this organization.",
    };
  try {
    const token = isEncrypted(integ.token)
      ? decryptSecret(integ.token)
      : integ.token;
    return { ok: true, config: { baseUrl: integ.baseUrl, token } };
  } catch {
    return { ok: false, error: "Could not decrypt the Coolify token." };
  }
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; resources: CoolifyResource[] }>();

/** Coolify's resources for an organization, cached for five minutes. */
export async function coolifyResources(
  organizationId: string,
  fresh = false
): Promise<
  { ok: true; resources: CoolifyResource[] } | { ok: false; error: string }
> {
  const hit = cache.get(organizationId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS)
    return { ok: true, resources: hit.resources };
  const cfg = await resolveCoolifyConfig(organizationId);
  if (!cfg.ok) return cfg;
  const res = await listResources(cfg.config);
  if (!res.ok) return res;
  cache.set(organizationId, { at: Date.now(), resources: res.data });
  return { ok: true, resources: res.data };
}

/** Whether the organization has Coolify connected (cheap: no API call). */
export async function hasCoolify(organizationId: string): Promise<boolean> {
  return (await resolveCoolifyConfig(organizationId)).ok;
}

/**
 * The Coolify application of a repository: same GitHub repository, the same
 * branch when several. Ambiguous → none; the user links it.
 */
export function matchCoolifyApp(
  repo: { githubUrl: string; defaultBranch: string },
  resources: CoolifyResource[]
): CoolifyResource | null {
  const slug = githubRepoOfUrl(repo.githubUrl);
  if (!slug) return null;
  const same = resources.filter(
    (r) => r.kind === "application" && r.githubRepo === slug
  );
  const onBranch = same.filter((r) => r.branch === repo.defaultBranch);
  const pick = onBranch.length ? onBranch : same;
  return pick.length === 1 ? pick[0]! : null;
}

/**
 * Link repositories to their Coolify applications (and take the live URL
 * from Coolify when none is set). Repositories deployed by Dokploy and links
 * someone set by hand are left alone.
 */
export async function syncCoolifyForOrg(
  organizationId: string
): Promise<
  | { ok: true; resources: CoolifyResource[]; linked: number }
  | { ok: false; error: string }
> {
  const res = await coolifyResources(organizationId, true);
  if (!res.ok) return res;
  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));
  let linked = 0;
  for (const repo of repos) {
    if (hasDeployTarget(repo)) continue;
    const app = matchCoolifyApp(repo, res.resources);
    if (!app) continue;
    linked++;
    await db
      .update(repositories)
      .set({
        coolifyAppUuid: app.uuid,
        ...(!repo.liveUrl && app.url && validateLiveUrl(app.url).ok
          ? { liveUrl: app.url }
          : {}),
      })
      .where(eq(repositories.id, repo.id));
  }
  return { ok: true, resources: res.resources, linked };
}

const DAY = 24 * 60 * 60 * 1000;

/** Published ports and backups of Coolify's databases, as findings. */
export function coolifyDatabaseFindings(
  d: CoolifyResource,
  now = Date.now()
): FindingInput[] {
  const out: FindingInput[] = [];
  const label = `${d.databaseType?.replace(/^standalone-/, "") ?? "database"} “${d.name}”`;
  if (d.isPublic) {
    out.push({
      fingerprint: `db-exposed|${d.uuid}`,
      severity: "high",
      title: `Database reachable from the internet: ${d.name}${d.publicPort ? ` on port ${d.publicPort}` : ""}`,
      detail: `Coolify makes the ${label} public${d.publicPort ? ` on port ${d.publicPort}` : ""}. Unless a firewall in front blocks it, anyone can try passwords against it. Turn off “Make it publicly available” in Coolify unless something outside really needs it.`,
      target: d.uuid,
    });
  }
  // Redis/KeyDB/Dragonfly are caches; Coolify backs up the others.
  if (/redis|keydb|dragonfly/.test(d.databaseType ?? "")) return out;
  if (!d.backups.length) {
    out.push({
      fingerprint: `db-no-backup|${d.uuid}`,
      severity: "medium",
      title: `No backup for database ${d.name}`,
      detail: `The ${label} has no scheduled backup in Coolify. Add one under the database → Backups (S3, daily).`,
      target: d.uuid,
    });
    return out;
  }
  d.backups.forEach((b, i) => {
    if (!b.enabled)
      out.push({
        fingerprint: `db-backup-off|${d.uuid}|${i}`,
        severity: "medium",
        title: `Backup of ${d.name} is switched off`,
        detail: `A backup of the ${label} exists in Coolify but is disabled.`,
        target: d.uuid,
      });
    else if (b.lastStatus === "failed")
      out.push({
        fingerprint: `db-backup-failed|${d.uuid}|${i}`,
        severity: "high",
        title: `Backup of ${d.name} failed`,
        detail: `The last backup run of the ${label}${b.lastAt ? ` (${b.lastAt})` : ""} failed. Its log is in Coolify under the database → Backups.`,
        target: d.uuid,
      });
    else if (b.lastAt && now - Date.parse(b.lastAt) > 8 * DAY)
      out.push({
        fingerprint: `db-backup-late|${d.uuid}|${i}`,
        severity: "medium",
        title: `Backup of ${d.name} has not run since ${b.lastAt.slice(0, 10)}`,
        detail: `The newest backup of the ${label} is more than a week old.`,
        target: d.uuid,
      });
  });
  return out;
}

/**
 * Coolify's databases on each server that reports their container, as
 * findings (source "coolify"). Coolify unreachable → nothing synced.
 */
export async function checkCoolifyRisks(organizationId: string): Promise<void> {
  const res = await coolifyResources(organizationId, true);
  if (!res.ok) return;
  const rows = await db
    .select({ id: servers.id, lastReport: servers.lastReport })
    .from(servers)
    .where(eq(servers.organizationId, organizationId));
  const dbs = res.resources.filter((r) => r.kind === "database");
  for (const row of rows) {
    const containers = ((row.lastReport as { containers?: unknown } | null)
      ?.containers ?? []) as Array<{
      app?: string | null;
      name?: string | null;
    }>;
    const here = new Map<string, CoolifyResource>();
    for (const c of containers) {
      const d = resourceOfContainer(c, dbs);
      if (d) here.set(d.uuid, d);
    }
    await syncAndNotify(
      row.id,
      "coolify",
      [...here.values()].flatMap((d) => coolifyDatabaseFindings(d))
    );
  }
}

const INTERVAL_MS = 15 * 60 * 1000;
const lastRun = new Map<string, number>();

export async function syncDueCoolify(): Promise<void> {
  const orgs = await db
    .select({ organizationId: orgIntegrations.organizationId })
    .from(orgIntegrations)
    .where(
      and(
        isNotNull(orgIntegrations.coolifyBaseUrl),
        isNotNull(orgIntegrations.coolifyToken)
      )
    );
  for (const o of orgs) {
    const last = lastRun.get(o.organizationId);
    if (last && Date.now() - last < INTERVAL_MS) continue;
    lastRun.set(o.organizationId, Date.now());
    await syncCoolifyForOrg(o.organizationId).catch((e) =>
      console.error("[coolify] sync failed:", e)
    );
    await checkCoolifyRisks(o.organizationId).catch((e) =>
      console.error("[coolify] risk check failed:", e)
    );
  }
}
