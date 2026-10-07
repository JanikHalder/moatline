import { db, servers } from "db";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";
import {
  allServices,
  platform,
  serviceOfContainer,
  type ManagedService,
  type ReportedContainer,
} from "./platforms";

/** Platforms' own containers and Docker's helpers — managed, just not a service. */
const SYSTEM =
  /^(dokploy([-_.].*)?|buildx_buildkit.*|coolify(-(proxy|db|redis|realtime|sentinel|helper))?|komodo([-_.].*)?|(komodo[-_])?periphery([-_.].*)?|portainer([-_.].*)?|portainer_agent.*)$/;
const COOLIFY_SYSTEM = /^coolify(-(proxy|db|redis|realtime|sentinel|helper))?$/;
/** Coolify names its resources with a 24-character id ("mail-ow8ook8skccoocckkcscoock"). */
const COOLIFY_ID = /(^|[-_])[a-z0-9]{24}($|[-_.])/;

/**
 * Containers no platform manages — never redeployed or updated: one-off
 * `docker run`s, compose files on the server, leftovers of a platform that
 * is not connected. Only on servers where a connected platform runs
 * something; elsewhere every container would count.
 */
export function unmanagedFindings(
  containers: ReportedContainer[],
  managed: ManagedService[],
  coolifyConnected: boolean
): FindingInput[] {
  const out: FindingInput[] = [];
  const coolify = containers.filter((c) => COOLIFY_SYSTEM.test(c.name ?? ""));
  if (coolify.length && !coolifyConnected)
    out.push({
      fingerprint: "coolify-running",
      severity: "medium",
      title: "Coolify runs on this server but is not connected",
      detail: `Containers ${coolify.map((c) => c.name).join(", ")}. What Coolify deployed is neither redeployed nor watched from here — connect Coolify under Settings, or move its apps and stop it.`,
      target: "coolify",
    });
  const platformHere = containers.some((c) => serviceOfContainer(c, managed));
  if (!platformHere) return out;
  for (const c of containers) {
    const name = c.name ?? "";
    if (!name || SYSTEM.test(name)) continue;
    if (serviceOfContainer(c, managed)) continue;
    const isCoolify =
      !coolifyConnected &&
      (COOLIFY_ID.test(name) || COOLIFY_ID.test(c.app ?? ""));
    out.push({
      fingerprint: `unmanaged|${c.app || name}`,
      severity: "low",
      title: `Container not managed by a platform: ${c.app || name}${isCoolify ? " (Coolify)" : ""}`,
      detail: isCoolify
        ? "Deployed by Coolify, which is not connected: no redeploys, no updates from here. Connect Coolify, or move it."
        : "Started outside the connected platforms (docker run, a compose file on the server …): nobody redeploys or updates it. Move it to a platform, or remove it if it is not needed.",
      target: c.app || name,
    });
    if (out.length >= 30) break;
  }
  return out;
}

const INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastRun = 0;

/** Every six hours, for every server: what no platform manages. */
export async function checkDueUnmanaged(): Promise<void> {
  if (Date.now() - lastRun < INTERVAL_MS) return;
  lastRun = Date.now();
  const rows = await db
    .select({
      id: servers.id,
      organizationId: servers.organizationId,
      lastReport: servers.lastReport,
    })
    .from(servers);
  const byOrg = new Map<
    string,
    { managed: ManagedService[]; coolify: boolean } | null
  >();
  for (const row of rows) {
    if (!byOrg.has(row.organizationId)) {
      const res = await allServices(row.organizationId).catch(() => null);
      const coolify = await platform("coolify")
        .configured(row.organizationId)
        .catch(() => false);
      // A platform that did not answer must not turn its apps into
      // "unmanaged": skip the organization until all of them answer.
      byOrg.set(
        row.organizationId,
        res && !res.error && !res.failed.length
          ? { managed: res.services, coolify }
          : null
      );
    }
    const ctx = byOrg.get(row.organizationId);
    if (!ctx) continue;
    const containers = ((row.lastReport as { containers?: unknown } | null)
      ?.containers ?? []) as ReportedContainer[];
    await syncAndNotify(
      row.id,
      "platform",
      unmanagedFindings(containers, ctx.managed, ctx.coolify)
    );
  }
}
