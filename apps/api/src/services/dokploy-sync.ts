import { and, eq, isNotNull } from "drizzle-orm";
import { db, orgIntegrations, repositories, servers } from "db";
import {
  listApplications,
  matchApplication,
  type DokployApplication,
} from "../lib/dokploy";
import { resolveDokployConfig } from "./deploy";
import { checkConfigForOrg } from "./config-check";

const INTERVAL_MS = 15 * 60 * 1000;
const lastSync = new Map<string, number>();

type ReportedContainer = { app?: string | null; name?: string | null };

/**
 * The server reporting a container of this Dokploy service. Dokploy runs an
 * application as a Swarm service named after its appName; the agent reports
 * that service name as the container's app.
 */
export function serverRunning(
  appName: string,
  rows: Array<{ id: string; lastReport: unknown }>
): string | null {
  const hits = rows.filter((s) => {
    const containers = ((s.lastReport as { containers?: unknown } | null)
      ?.containers ?? []) as ReportedContainer[];
    return containers.some(
      (c) =>
        c.app === appName ||
        !!c.app?.startsWith(`${appName}-`) ||
        !!c.app?.startsWith(`${appName}_`) ||
        c.name?.startsWith(`${appName}.`)
    );
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * Link repositories to their Dokploy applications: the application ID (for
 * deploys), its service name (to find its containers and image CVEs) and,
 * when nobody set one, the server it runs on. A link the user set is never
 * replaced — only its service name is refreshed.
 */
export async function syncDokployForOrg(
  organizationId: string
): Promise<
  | { ok: true; apps: DokployApplication[]; linked: number; projects: number }
  | { ok: false; error: string }
> {
  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return cfg;
  const list = await listApplications(cfg.config);
  lastSync.set(organizationId, Date.now());
  if (!list.ok) return list;

  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));
  const serverRows = await db
    .select({ id: servers.id, lastReport: servers.lastReport })
    .from(servers)
    .where(eq(servers.organizationId, organizationId));

  let linked = 0;
  for (const repo of repos) {
    const app = repo.dokployApplicationId
      ? list.apps.find((a) => a.applicationId === repo.dokployApplicationId)
      : matchApplication(repo, list.apps);
    const updates: Partial<typeof repositories.$inferInsert> = {};
    if (!repo.dokployApplicationId && app) {
      updates.dokployApplicationId = app.applicationId;
      linked++;
    }
    const appName = app?.appName ?? null;
    if (appName !== repo.dokployAppName) updates.dokployAppName = appName;
    if (app && app.kind !== repo.dokployKind) updates.dokployKind = app.kind;
    if (!repo.serverId && appName) {
      const serverId = serverRunning(appName, serverRows);
      if (serverId) updates.serverId = serverId;
    }
    if (Object.keys(updates).length) {
      await db
        .update(repositories)
        .set(updates)
        .where(eq(repositories.id, repo.id));
    }
  }
  // In the background: one request per application, not worth waiting for.
  void checkConfigForOrg(organizationId, list.apps).catch((e) =>
    console.error("[dokploy] config check failed:", e)
  );
  return { ok: true, apps: list.apps, linked, projects: list.projects };
}

export async function syncDueDokploy(): Promise<void> {
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
    const last = lastSync.get(o.organizationId);
    if (last && Date.now() - last < INTERVAL_MS) continue;
    await syncDokployForOrg(o.organizationId).catch((e) =>
      console.error("[dokploy] sync failed:", e)
    );
  }
}

/**
 * The repository behind a container's app name. Applications run as a
 * Swarm service named exactly like their appName; compose stacks prefix
 * every service with it ("<appName>-web" with docker compose, "<appName>_web"
 * as a stack).
 */
export function repoForApp(
  app: string,
  byAppName: Map<string, string>
): string | null {
  const exact = byAppName.get(app);
  if (exact) return exact;
  for (const [name, repo] of byAppName)
    if (app.startsWith(`${name}-`) || app.startsWith(`${name}_`)) return repo;
  return null;
}

/** Dokploy service name → repository, for one organization's repositories. */
export async function reposByAppName(
  organizationId: string
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: repositories.id, appName: repositories.dokployAppName })
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        isNotNull(repositories.dokployAppName)
      )
    );
  return new Map(rows.map((r) => [r.appName!, r.id]));
}
