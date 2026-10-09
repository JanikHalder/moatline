import {
  cleanDocker,
  listDokployServers,
  listServices,
  type DokployServer,
  type DokployService,
} from "../lib/dokploy";
import { resolveDokployConfig } from "./deploy";
import {
  allServices,
  platform,
  serviceOfContainer,
  type ManagedService,
  type PlatformId,
} from "./platforms";
import { dokployNodeOf } from "./dokploy-risk";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; services: DokployService[] }>();

type Container = { app?: string | null; name?: string | null };

export async function servicesOf(
  organizationId: string,
  fresh = false
): Promise<
  { ok: true; services: DokployService[] } | { ok: false; error: string }
> {
  const hit = cache.get(organizationId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS)
    return { ok: true, services: hit.services };
  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return cfg;
  const list = await listServices(cfg.config);
  if (!list.ok) return list;
  cache.set(organizationId, { at: Date.now(), services: list.apps });
  return { ok: true, services: list.apps };
}

export type ContainerService = {
  provider: PlatformId;
  kind: string;
  name: string;
  project: string;
  environment: string | null;
};

const shown = (s: ManagedService): ContainerService => ({
  provider: s.platform,
  kind: s.kind,
  name: s.name,
  project: s.project,
  environment: s.environment,
});

/**
 * For each reported container (by app name), the platform service it
 * belongs to — what a redeploy would restart. Containers no connected
 * platform runs are left out.
 */
export async function containerServices(
  organizationId: string,
  containers: Container[]
): Promise<
  | { ok: true; services: Record<string, ContainerService> }
  | { ok: false; error: string }
> {
  const res = await allServices(organizationId);
  if (res.error) return { ok: false, error: res.error };
  const out: Record<string, ContainerService> = {};
  for (const c of containers) {
    const key = c.app || c.name;
    const s = key ? serviceOfContainer(c, res.services) : null;
    if (key && s) out[key] = shown(s);
  }
  return { ok: true, services: out };
}

/**
 * Redeploy the platform service behind one of the server's containers.
 * Only a container the server itself reported can be redeployed — never
 * an arbitrary service by name.
 */
export async function redeployContainer(
  organizationId: string,
  containers: Container[],
  app: string
): Promise<
  | { ok: true; service: ContainerService }
  | { ok: false; error: string; status: 400 | 404 | 502 }
> {
  const container = containers.find((c) => (c.app || c.name) === app);
  if (!container)
    return {
      ok: false,
      error: "This server does not report that container.",
      status: 404,
    };
  // A fresh list: the cached one may predate a service that was re-created.
  const res = await allServices(organizationId, true);
  const s = serviceOfContainer(container, res.services);
  if (!s)
    return {
      ok: false,
      error:
        res.error ??
        "No connected platform runs this container, so it cannot be redeployed.",
      status: 404,
    };
  const r = await platform(s.platform).redeployService(organizationId, s);
  if (!r.ok) return { ok: false, error: r.error, status: 502 };
  return { ok: true, service: shown(s) };
}

/**
 * Clear Docker's build cache or unused images on a server through Dokploy.
 * Which Dokploy server that is follows from the services its agent reports.
 */
export async function cleanServerDocker(
  organizationId: string,
  serverId: string,
  rows: Array<{ id: string; lastReport: unknown; address?: string | null }>,
  what: "builder" | "images" | "containers"
): Promise<{ ok: true } | { ok: false; error: string; status: 400 | 502 }> {
  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return { ok: false, error: cfg.error, status: 400 };
  const res = await servicesOf(organizationId);
  if (!res.ok) return { ok: false, error: res.error, status: 400 };
  let node = dokployNodeOf(serverId, res.services, rows);
  // No app of Dokploy's runs there (the Dokploy host with apps elsewhere,
  // or a remote server whose apps are stopped): tell by Dokploy's own
  // container, or by the address and name Dokploy has for its servers.
  if (node === undefined) {
    const row = rows.find((r) => r.id === serverId);
    const list = await listDokployServers(cfg.config);
    node = row
      ? dokployNodeByHost(row, list.ok ? list.servers : [])
      : undefined;
  }
  if (node === undefined)
    return {
      ok: false,
      error:
        `Moatline cannot tell which Dokploy server this is. Clear it on the server: ${
          {
            builder: "docker builder prune -af",
            images: "docker image prune -af",
            containers: "docker container prune -f",
          }[what]
        }` +
        " — or give the server the same address as in Dokploy (Remote Servers).",
      status: 400,
    };
  const r = await cleanDocker({ ...cfg.config, what, serverId: node });
  if (!r.ok)
    return {
      ok: false,
      error:
        r.status === 401 || r.status === 403
          ? "Dokploy refused: cleaning needs an API key of an admin or owner."
          : `Dokploy refused the cleanup (HTTP ${r.status}): ${r.body || "no details"}`,
      status: 502,
    };
  return { ok: true };
}

/**
 * Which Dokploy node a server is without any of its apps: null for the
 * Dokploy host (it runs Dokploy itself), a Dokploy server id when the
 * address or hostname matches one Dokploy has, undefined otherwise.
 */
export function dokployNodeByHost(
  row: { lastReport: unknown; address?: string | null },
  dokployServers: DokployServer[]
): string | null | undefined {
  const report = (row.lastReport ?? {}) as {
    containers?: Array<{ app?: string | null; name?: string | null }>;
    host?: { hostname?: string | null };
    tailscale?: { ips?: string[]; hostname?: string | null } | null;
  };
  const containers = Array.isArray(report.containers) ? report.containers : [];
  if (
    containers.some(
      (c) => c.app === "dokploy" || /^dokploy(\.\d+\.|$)/.test(c.name ?? "")
    )
  )
    return null;
  const addresses = new Set(
    [row.address, ...(report.tailscale?.ips ?? [])]
      .filter((a): a is string => !!a)
      .map((a) => a.trim().toLowerCase())
  );
  const names = new Set(
    [report.host?.hostname, report.tailscale?.hostname]
      .filter((n): n is string => !!n)
      .map((n) => n.trim().toLowerCase())
  );
  const match =
    dokployServers.find(
      (d) => d.ipAddress && addresses.has(d.ipAddress.trim().toLowerCase())
    ) ?? dokployServers.find((d) => names.has(d.name.trim().toLowerCase()));
  return match ? match.serverId : undefined;
}
