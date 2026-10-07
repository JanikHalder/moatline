import { and, eq, isNotNull } from "drizzle-orm";
import { db, orgIntegrations, servers } from "db";
import {
  DATABASE_KINDS,
  databaseDetails,
  listDokployServers,
  serviceOfContainer,
  type DatabaseDetails,
  type DokployDatabaseKind,
  type DokployService,
} from "../lib/dokploy";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";
import { resolveDokployConfig } from "./deploy";
import { servicesOf } from "./container-redeploy";

const INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const lastRun = new Map<string, number>();

type ServerRow = { id: string; lastReport: unknown };
type Reported = { app?: string | null; name?: string | null };

const containersOf = (s: ServerRow): Reported[] => {
  const list = (s.lastReport as { containers?: unknown } | null)?.containers;
  return Array.isArray(list) ? list : [];
};

/** "host" for the Dokploy host itself, else Dokploy's server id. */
const dokployNode = (s: DokployService) => s.serverId ?? "host";

/**
 * Which Moatline server each Dokploy service runs on: by the
 * containers the agents report, and — for a service with no container
 * running right now — by the Dokploy server the others on it share.
 */
export function placeServices(
  services: DokployService[],
  rows: ServerRow[]
): Map<string, string> {
  const placed = new Map<string, string>();
  const votes = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const c of containersOf(row)) {
      const s = serviceOfContainer(c, services);
      if (!s || placed.has(s.applicationId)) continue;
      placed.set(s.applicationId, row.id);
      const v = votes.get(dokployNode(s)) ?? new Map<string, number>();
      v.set(row.id, (v.get(row.id) ?? 0) + 1);
      votes.set(dokployNode(s), v);
    }
  }
  const nodeServer = new Map<string, string>();
  for (const [node, v] of votes) {
    const best = [...v].sort((a, b) => b[1] - a[1])[0];
    if (best) nodeServer.set(node, best[0]);
  }
  for (const s of services) {
    if (placed.has(s.applicationId)) continue;
    const server = nodeServer.get(dokployNode(s));
    if (server) placed.set(s.applicationId, server);
  }
  return placed;
}

/**
 * Dokploy's id for a Moatline server (null: the Dokploy host), from
 * the services its agent reports. undefined when Dokploy runs nothing there.
 */
export function dokployNodeOf(
  serverId: string,
  services: DokployService[],
  rows: ServerRow[]
): string | null | undefined {
  const placed = placeServices(services, rows);
  const counts = new Map<string, number>();
  for (const s of services)
    if (placed.get(s.applicationId) === serverId)
      counts.set(dokployNode(s), (counts.get(dokployNode(s)) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (!best) return undefined;
  return best[0] === "host" ? null : best[0];
}

/** Daily schedules ("m h * * *") are late after two days, others after eight. */
function lateAfter(schedule: string | null): number {
  const f = (schedule ?? "").trim().split(/\s+/);
  return f.length >= 5 && f[2] === "*" && f[4] === "*" ? 2 * DAY : 8 * DAY;
}

const BACKUPS_IN_DOKPLOY = new Set<DokployDatabaseKind>([
  "postgres",
  "mysql",
  "mariadb",
  "mongo",
]);

/** What can go wrong with one database, as findings. */
export function databaseFindings(
  s: DokployService,
  d: DatabaseDetails,
  now = Date.now()
): FindingInput[] {
  const kind = s.kind as DokployDatabaseKind;
  const where = [s.project, s.environment].filter(Boolean).join(" / ");
  const label = `${kind} “${s.name}”${where ? ` (${where})` : ""}`;
  const out: FindingInput[] = [];
  if (d.externalPort) {
    out.push({
      fingerprint: `db-exposed|${s.applicationId}`,
      severity: "high",
      title: `Database reachable from the internet: ${s.name} on port ${d.externalPort}`,
      detail: `Dokploy publishes port ${d.externalPort} of the ${label} on the server. Unless a firewall in front blocks it, anyone can try passwords against it. Apps on the same server reach it over the internal network — remove the external port in Dokploy (database → External Credentials) unless something outside really needs it.`,
      target: s.appName,
    });
  }
  if (!BACKUPS_IN_DOKPLOY.has(kind)) return out;
  if (!d.backups.length) {
    out.push({
      fingerprint: `db-no-backup|${s.applicationId}`,
      severity: "medium",
      title: `No backup for database ${s.name}`,
      detail: `The ${label} has no backup in Dokploy. Add one under database → Backups (an S3 destination, daily).`,
      target: s.appName,
    });
    return out;
  }
  for (const b of d.backups) {
    const what = `Backup of ${s.name}${b.database ? ` (${b.database})` : ""}`;
    if (!b.enabled) {
      out.push({
        fingerprint: `db-backup-off|${b.backupId}`,
        severity: "medium",
        title: `${what} is switched off`,
        detail: `The backup of the ${label}${b.destination ? ` to ${b.destination}` : ""} exists in Dokploy but is disabled.`,
        target: s.appName,
      });
      continue;
    }
    const run = b.lastRun;
    if (run?.status === "error") {
      out.push({
        fingerprint: `db-backup-failed|${b.backupId}`,
        severity: "high",
        title: `${what} failed`,
        detail: `The last backup run of the ${label}${run.at ? ` (${run.at})` : ""} failed. Its log is in Dokploy under database → Backups.`,
        target: s.appName,
      });
    } else if (run?.at && now - Date.parse(run.at) > lateAfter(b.schedule)) {
      out.push({
        fingerprint: `db-backup-late|${b.backupId}`,
        severity: "medium",
        title: `${what} has not run since ${run.at.slice(0, 10)}`,
        detail: `Schedule ${b.schedule ?? "unknown"} — the newest run of the ${label} is older than it should be.`,
        target: s.appName,
      });
    }
  }
  return out;
}

/**
 * The databases Dokploy runs for one organization: published ports and
 * backups, as findings on the server each one runs on. Dokploy not reachable
 * → nothing is synced, so nothing is wrongly marked resolved.
 */
export async function checkDokployRisks(
  organizationId: string
): Promise<
  | { ok: true; databases: number; unplaced: number }
  | { ok: false; error: string }
> {
  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return cfg;
  const list = await servicesOf(organizationId, true);
  if (!list.ok) return list;
  const rows = await db
    .select({ id: servers.id, lastReport: servers.lastReport })
    .from(servers)
    .where(eq(servers.organizationId, organizationId));
  const placed = placeServices(list.services, rows);
  const dbs = list.services.filter((s) =>
    (DATABASE_KINDS as readonly string[]).includes(s.kind)
  );

  const byServer = new Map<string, FindingInput[]>(rows.map((r) => [r.id, []]));
  let unplaced = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, dbs.length) }, async () => {
      while (next < dbs.length) {
        const s = dbs[next++]!;
        const res = await databaseDetails({
          ...cfg.config,
          id: s.applicationId,
          kind: s.kind as DokployDatabaseKind,
        });
        if (!res.ok) {
          failed++;
          continue;
        }
        const server = placed.get(s.applicationId);
        if (!server) {
          unplaced++;
          continue;
        }
        byServer.get(server)?.push(...databaseFindings(s, res.details));
      }
    })
  );
  // A partial answer would resolve findings that are still true.
  if (failed && failed === dbs.length)
    return { ok: false, error: "Dokploy answered no database details." };
  if (failed)
    return { ok: false, error: `${failed} database(s) could not be read.` };
  for (const [serverId, items] of byServer)
    await syncAndNotify(serverId, "dokploy", items);
  return { ok: true, databases: dbs.length, unplaced };
}

export async function checkDueDokployRisks(): Promise<void> {
  const orgs = await db
    .select({ organizationId: orgIntegrations.organizationId })
    .from(orgIntegrations)
    .where(
      and(
        isNotNull(orgIntegrations.dokployBaseUrl),
        isNotNull(orgIntegrations.dokployToken)
      )
    );
  for (const o of orgs) {
    const last = lastRun.get(o.organizationId);
    if (last && Date.now() - last < INTERVAL_MS) continue;
    lastRun.set(o.organizationId, Date.now());
    const res = await checkDokployRisks(o.organizationId).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (!res.ok) console.error("[dokploy] risk check failed:", res.error);
  }
}

export type MissingServer = {
  /** Dokploy's server id; null for the Dokploy host itself. */
  dokployServerId: string | null;
  name: string;
  address: string | null;
};

/**
 * Servers Dokploy deploys to that no agent watches: no Moatline
 * server reports their services, and none has their address.
 */
export function missingServers(
  dokployServers: Array<{
    serverId: string;
    name: string;
    ipAddress: string | null;
  }>,
  services: DokployService[],
  rows: Array<ServerRow & { address: string | null }>,
  dokployHost: string | null
): MissingServer[] {
  const covered = new Set<string>();
  for (const row of rows) {
    const node = dokployNodeOf(row.id, services, rows);
    if (node !== undefined) covered.add(node ?? "host");
  }
  const addresses = new Set(
    rows.map((r) => r.address?.trim().toLowerCase()).filter(Boolean)
  );
  const out: MissingServer[] = [];
  if (
    services.some((s) => !s.serverId) &&
    !covered.has("host") &&
    !(dokployHost && addresses.has(dokployHost.toLowerCase()))
  )
    out.push({
      dokployServerId: null,
      name: "Dokploy host",
      address: dokployHost,
    });
  for (const d of dokployServers) {
    if (covered.has(d.serverId)) continue;
    if (d.ipAddress && addresses.has(d.ipAddress.toLowerCase())) continue;
    out.push({
      dokployServerId: d.serverId,
      name: d.name,
      address: d.ipAddress,
    });
  }
  return out;
}

export async function missingServersForOrg(
  organizationId: string
): Promise<
  { ok: true; servers: MissingServer[] } | { ok: false; error: string }
> {
  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return cfg;
  const [list, remote] = await Promise.all([
    servicesOf(organizationId),
    listDokployServers(cfg.config),
  ]);
  if (!list.ok) return list;
  const rows = await db
    .select({
      id: servers.id,
      lastReport: servers.lastReport,
      address: servers.address,
    })
    .from(servers)
    .where(eq(servers.organizationId, organizationId));
  let host: string | null = null;
  try {
    host = new URL(cfg.config.baseUrl).hostname;
  } catch {
    host = null;
  }
  return {
    ok: true,
    // Without server.all (older Dokploy, member key) only the host is checked.
    servers: missingServers(
      remote.ok ? remote.servers : [],
      list.services,
      rows,
      host
    ),
  };
}
