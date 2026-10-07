import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db, repositories, serverFindings, servers } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization, requireSession } from "../middleware/tenant";
import { audit } from "../lib/audit-log";
import {
  assignMonitorToServer,
  syncKumaForOrg,
  uptimeOverview,
} from "../services/kuma";

const SOURCES = [
  "host",
  "trivy",
  "crowdsec",
  "nuclei",
  "kuma",
  "wazuh",
  "heartbeat",
  "network",
  "security",
  "provider",
  "dokploy",
  "registry",
  "coolify",
  "platform",
] as const;

const findingsQuery = z.object({
  source: z.enum(SOURCES).optional(),
  /** Only what belongs on a to-do list: critical and high, plus medium
   * outside Trivy (whose medium CVEs are the bulk of every list). */
  important: z.enum(["true"]).optional(),
});

const assignSchema = z.object({
  monitor: z.string().trim().min(1).max(200),
  serverId: z.string().uuid().nullable(),
});

/**
 * Organization-wide monitoring views: every Uptime Kuma monitor, and every
 * open finding across all servers and tools in one place.
 */
export const monitoringRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/uptime", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(await uptimeOverview(orgId));
  })
  .post("/uptime/refresh", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    await syncKumaForOrg(orgId);
    return c.json(await uptimeOverview(orgId));
  })
  .put("/uptime/assign", zValidator("json", assignSchema), async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const { monitor, serverId } = c.req.valid("json");
    const ok = await assignMonitorToServer(orgId, monitor, serverId);
    if (!ok) return c.json({ error: "Server not found" }, 404);
    await audit(
      c,
      "kuma.assign",
      { type: "monitor", name: monitor },
      { serverId }
    );
    // Move the monitor's findings to its new server right away.
    await syncKumaForOrg(orgId).catch((e) =>
      console.error("[monitoring] Kuma sync after assign failed:", e)
    );
    return c.json(await uptimeOverview(orgId));
  })
  .get("/findings", zValidator("query", findingsQuery), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const { source, important } = c.req.valid("query");
    const orgServers = await db
      .select({ id: servers.id, name: servers.name })
      .from(servers)
      .where(eq(servers.organizationId, orgId));
    if (orgServers.length === 0) return c.json([]);
    const where = [
      inArray(
        serverFindings.serverId,
        orgServers.map((s) => s.id)
      ),
      isNull(serverFindings.resolvedAt),
    ];
    if (source) where.push(eq(serverFindings.source, source));
    if (important)
      where.push(
        or(
          inArray(serverFindings.severity, ["critical", "high"]),
          and(
            eq(serverFindings.severity, "medium"),
            ne(serverFindings.source, "trivy")
          )
        )!
      );
    const rows = await db
      .select({
        finding: serverFindings,
        repositoryName: repositories.name,
      })
      .from(serverFindings)
      .leftJoin(repositories, eq(repositories.id, serverFindings.repositoryId))
      .where(and(...where))
      .orderBy(desc(serverFindings.lastSeenAt))
      .limit(5000);
    const names = new Map(orgServers.map((s) => [s.id, s.name]));
    return c.json(
      rows.map((r) => ({
        ...r.finding,
        serverName: names.get(r.finding.serverId) ?? null,
        repositoryName: r.repositoryName,
      }))
    );
  });
