import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
} from "drizzle-orm";
import {
  clients,
  db,
  repositories,
  serverFindings,
  serverMetrics,
  containerMetrics,
  serverScanRuns,
  servers,
} from "db";
import type { TenantVariables } from "../middleware/tenant";
import {
  requireOrgAdmin,
  requireOrganization,
  requireSession,
} from "../middleware/tenant";
import { generateEnrollmentCode } from "../lib/agent-token";
import { audit } from "../lib/audit-log";
import { clientIp, isPublicIp } from "../lib/client-ip";
import { validateLiveUrl } from "../lib/live-check";
import { openCountsByServer, emptyFindingCounts } from "../lib/server-findings";
import { isValidSchedule, nextRunAt } from "../services/scheduler";
import { STALE_AFTER_MS } from "../services/server-scheduler";
import { startNucleiRun } from "../services/nuclei";
import { missingServersForOrg } from "../services/dokploy-risk";
import { imageStatuses } from "../services/image-freshness";
import { errorSummary } from "../services/log-errors";
import { osSupport } from "../lib/os-support";
import {
  cleanServerDocker,
  containerServices,
  redeployContainer,
} from "../services/container-redeploy";
import { resolveAddress, runNetworkCheck } from "../services/network-check";
import { syncFindings } from "../lib/server-findings";
import { accessIdentities } from "../services/security-findings";
import {
  fetchKumaMonitors,
  resolveKumaConfig,
  syncKumaForOrg,
} from "../services/kuma";
import {
  agentScript,
  bundledAgentVersion,
  isOlderVersion,
  SETUP_SCRIPTS,
  setupScript,
} from "./agent";
import { blockedBy } from "../services/billing";

type Ctx = Context<{ Variables: TenantVariables }>;
type ServerRow = typeof servers.$inferSelect;

const TOKEN_ADMIN_ONLY =
  "Only an owner or admin can add servers or issue agent tokens.";

/**
 * The URL agents report to. Often not the URL people browse: with the app
 * servers on a tailnet it is the Moatline host's tailnet address
 * (AGENT_BASE_URL=http://100.x.y.z:3001 or https://<name>.<tailnet>.ts.net).
 */
export function agentBaseUrl(c: Ctx): string {
  const configured =
    process.env.AGENT_BASE_URL ||
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL;
  return (configured || new URL(c.req.url).origin).replace(/\/+$/, "");
}

/** Hosts an agent elsewhere can never reach — worth a warning in the UI. */
function isLocalOnly(base: string): boolean {
  try {
    const h = new URL(base).hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function installInstructions(c: Ctx) {
  const base = agentBaseUrl(c);
  const script = agentScript();
  const sha = script?.sha256 ?? "<checksum unavailable>";
  return {
    baseUrl: base,
    baseUrlLocalOnly: isLocalOnly(base),
    scriptUrl: `${base}/api/agent/pc-agent.py`,
    bootstrapUrl: `${base}/api/agent/install.sh`,
    // Hardening and automatic updates (save-server), same checksum pattern.
    setupScripts: SETUP_SCRIPTS.map((name) => ({
      name,
      url: `${base}/api/agent/scripts/${name}`,
      sha256: setupScript(name)?.sha256 ?? null,
    })),
    sha256: script?.sha256 ?? null,
    // Updates an installed agent in place: same token, same settings.
    updateCommand: `curl -fsSL ${base}/api/agent/install.sh | sudo bash`,
    // Manual path for those who want to read the script before running it.
    commands: [
      `curl -fsSL -o /tmp/pc-agent.py ${base}/api/agent/pc-agent.py`,
      `echo "${sha}  /tmp/pc-agent.py" | sha256sum -c -`,
      `sudo python3 /tmp/pc-agent.py install --url ${base}`,
    ],
  };
}

async function issueEnrollment(serverId: string) {
  const e = generateEnrollmentCode();
  await db
    .update(servers)
    .set({ enrollmentCodeHash: e.hash, enrollmentExpiresAt: e.expiresAt })
    .where(eq(servers.id, serverId));
  return { code: e.code, expiresAt: e.expiresAt.toISOString() };
}

const srv = (s: { id: string; name: string }) => ({
  type: "server",
  id: s.id,
  name: s.name,
});

export type ServerStatus = "reporting" | "stale" | "never";

function agentStatus(s: ServerRow, now = Date.now()): ServerStatus {
  if (!s.lastReportAt) return "never";
  return now - s.lastReportAt.getTime() > STALE_AFTER_MS
    ? "stale"
    : "reporting";
}

/** The row as the client sees it: never the token hash. */
function publicServer(s: ServerRow) {
  const { agentTokenHash, enrollmentCodeHash, ...rest } = s;
  const latest = bundledAgentVersion();
  return {
    ...rest,
    enrollmentPending:
      !!enrollmentCodeHash &&
      !!s.enrollmentExpiresAt &&
      s.enrollmentExpiresAt.getTime() > Date.now(),
    agentTokenSet: !!agentTokenHash,
    agentStatus: agentStatus(s),
    // The agent never updates itself (it accepts no commands); the UI says
    // when a reinstall would bring new checks.
    latestAgentVersion: latest,
    agentOutdated:
      !!s.agentVersion && !!latest && isOlderVersion(s.agentVersion, latest),
  };
}

function reportedContainers(
  server: ServerRow
): Array<{ app?: string | null; name?: string | null }> {
  const list = (server.lastReport as { containers?: unknown } | null)
    ?.containers;
  return Array.isArray(list) ? list : [];
}

async function loadServer(c: Ctx, orgId: string): Promise<ServerRow | null> {
  const [row] = await db
    .select()
    .from(servers)
    .where(
      and(eq(servers.id, c.req.param("id")!), eq(servers.organizationId, orgId))
    )
    .limit(1);
  return row ?? null;
}

const addressField = z.string().trim().max(253).nullable().optional();
const portsField = z
  .array(z.number().int().min(1).max(65535))
  .max(30)
  .optional();

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: addressField,
  expectedPorts: portsField,
});

const percent = z.number().int().min(10).max(100);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  clientId: z.string().uuid().nullable().optional(),
  nucleiTargets: z.array(z.string().trim().max(500)).max(50).optional(),
  nucleiSchedule: z.string().trim().max(100).nullable().optional(),
  kumaMonitors: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  // Wazuh agent IDs are zero-padded numbers ("001").
  wazuhAgentId: z
    .string()
    .trim()
    .regex(/^\d{1,8}$/, "A Wazuh agent ID is a number such as 001")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  cpuThreshold: percent.optional(),
  memoryThreshold: percent.optional(),
  diskThreshold: percent.optional(),
  address: addressField,
  expectedPorts: portsField,
  storageChecks: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        path: z
          .string()
          .trim()
          .max(500)
          .refine(
            (p) => p.startsWith("/") && !p.split("/").includes(".."),
            "Use an absolute path without '..'"
          )
          .nullable(),
        limitGb: z.number().positive().max(1_000_000).nullable(),
      })
    )
    .max(30)
    .refine(
      (list) => new Set(list.map((c) => c.name)).size === list.length,
      "Each storage needs its own name"
    )
    .optional(),
  backupChecks: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        path: z
          .string()
          .trim()
          .max(500)
          .refine(
            (p) => p.startsWith("/") && !p.split("/").includes(".."),
            "Use an absolute path without '..'"
          ),
        maxAgeHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 30),
      })
    )
    .max(20)
    .optional(),
  // Applications running on this server.
  repositoryIds: z.array(z.string().uuid()).max(200).optional(),
});

const findingsQuery = z.object({
  status: z.enum(["open", "resolved"]).default("open"),
  source: z
    .enum([
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
    ])
    .optional(),
  /** Only fingerprints starting with this — one image's CVEs: "image|<ref>|". */
  prefix: z.string().max(600).optional(),
});

export const serversRouter = new Hono<{ Variables: TenantVariables }>()
  // The address this browser reaches Moatline from — offered as the
  // office IP to never ban (--trust-ip) in the setup commands.
  .get("/my-ip", (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const ip = clientIp(c);
    return c.json({ ip: isPublicIp(ip) ? ip : null });
  })
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const rows = await db
      .select()
      .from(servers)
      .where(eq(servers.organizationId, orgId))
      .orderBy(asc(servers.name));
    const ids = rows.map((r) => r.id);
    const counts = await openCountsByServer(ids);
    const runs = ids.length
      ? await db
          .select({
            serverId: serverScanRuns.serverId,
            status: serverScanRuns.status,
            startedAt: serverScanRuns.startedAt,
            findingCount: serverScanRuns.findingCount,
          })
          .from(serverScanRuns)
          .where(inArray(serverScanRuns.serverId, ids))
          .orderBy(desc(serverScanRuns.startedAt))
      : [];
    const lastRun = new Map<string, (typeof runs)[number]>();
    for (const r of runs)
      if (!lastRun.has(r.serverId)) lastRun.set(r.serverId, r);
    const apps = ids.length
      ? await db
          .select({
            id: repositories.id,
            name: repositories.name,
            serverId: repositories.serverId,
          })
          .from(repositories)
          .where(inArray(repositories.serverId, ids))
      : [];
    return c.json(
      rows.map((s) => ({
        ...publicServer(s),
        counts: counts.get(s.id) ?? emptyFindingCounts(),
        lastNucleiRun: lastRun.get(s.id) ?? null,
        applications: apps
          .filter((a) => a.serverId === s.id)
          .map((a) => ({ id: a.id, name: a.name })),
      }))
    );
  })
  .post("/", zValidator("json", createSchema), async (c) => {
    const orgId = await requireOrgAdmin(c, TOKEN_ADMIN_ONLY);
    if (orgId instanceof Response) return orgId;
    const blocked = await blockedBy(orgId, "server");
    if (blocked) return c.json({ error: blocked }, 402);
    const { name, address, expectedPorts } = c.req.valid("json");
    const addr = address?.trim() || null;
    if (addr) {
      const resolved = await resolveAddress(addr);
      if (!resolved.ok) return c.json({ error: resolved.reason }, 400);
    }
    const [row] = await db
      .insert(servers)
      .values({
        organizationId: orgId,
        name,
        address: addr,
        ...(expectedPorts
          ? { expectedPorts: [...new Set(expectedPorts)] }
          : {}),
      })
      .returning();
    const enrollment = await issueEnrollment(row!.id);
    if (addr) {
      void runNetworkCheck(row!.id).catch((e) =>
        console.error("[servers] first network check failed:", e)
      );
    }
    await audit(c, "server.create", srv(row!), { address: addr });
    await audit(c, "server.install_code", srv(row!));
    // The code is returned exactly once — only its hash is stored.
    return c.json(
      {
        server: publicServer(row!),
        enrollment,
        install: installInstructions(c),
      },
      201
    );
  })
  // Agents behind the bundled version, and the command that updates them.
  // The agent never updates itself (it takes no commands): this is for a
  // person to run over SSH.
  .get("/agent-update", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const latest = bundledAgentVersion();
    const rows = await db
      .select({
        id: servers.id,
        name: servers.name,
        address: servers.address,
        agentVersion: servers.agentVersion,
      })
      .from(servers)
      .where(eq(servers.organizationId, orgId));
    const outdated = rows.filter(
      (s) =>
        !!s.agentVersion && !!latest && isOlderVersion(s.agentVersion, latest)
    );
    return c.json({
      latest,
      command: installInstructions(c).updateCommand,
      servers: outdated,
    });
  })
  // OS, kernel, Docker and updates of every server, with end of support.
  .get("/versions", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const latest = bundledAgentVersion();
    const rows = await db
      .select({
        id: servers.id,
        name: servers.name,
        lastReport: servers.lastReport,
        lastReportAt: servers.lastReportAt,
        agentVersion: servers.agentVersion,
      })
      .from(servers)
      .where(eq(servers.organizationId, orgId));
    return c.json({
      latestAgent: latest,
      servers: rows
        .map((s) => {
          const r = (s.lastReport ?? {}) as {
            host?: {
              os?: string | null;
              kernel?: string | null;
              dockerVersion?: string | null;
              uptimeSeconds?: number | null;
            };
            updates?: {
              pending?: number;
              security?: number;
              rebootRequired?: boolean | null;
              autoUpdates?: boolean | null;
            } | null;
          };
          return {
            id: s.id,
            name: s.name,
            os: r.host?.os ?? null,
            support: osSupport(r.host?.os),
            kernel: r.host?.kernel ?? null,
            docker: r.host?.dockerVersion ?? null,
            uptimeDays:
              r.host?.uptimeSeconds != null
                ? Math.floor(r.host.uptimeSeconds / 86400)
                : null,
            pending: r.updates?.pending ?? null,
            security: r.updates?.security ?? null,
            rebootRequired: !!r.updates?.rebootRequired,
            autoUpdates: r.updates?.autoUpdates ?? null,
            agentVersion: s.agentVersion,
            agentOutdated:
              !!s.agentVersion &&
              !!latest &&
              isOlderVersion(s.agentVersion, latest),
            lastReportAt: s.lastReportAt?.toISOString() ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  })
  // Servers Dokploy deploys to without an agent here — nothing overlooked.
  .get("/dokploy-missing", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const res = await missingServersForOrg(orgId);
    if (!res.ok) return c.json({ servers: [], error: res.error });
    return c.json({ servers: res.servers });
  })
  .get("/kuma/monitors", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const config = await resolveKumaConfig(orgId);
    if (!config) {
      return c.json(
        { error: "Uptime Kuma is not configured under Settings." },
        400
      );
    }
    try {
      const monitors = await fetchKumaMonitors(config.baseUrl, config.apiKey);
      return c.json({
        monitors: monitors.map((m) => ({
          name: m.name,
          url: m.url,
          type: m.type,
        })),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  })
  .get("/:id", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const apps = await db
      .select({
        id: repositories.id,
        name: repositories.name,
        liveUrl: repositories.liveUrl,
        liveStatus: repositories.liveStatus,
      })
      .from(repositories)
      .where(eq(repositories.serverId, server.id));
    const counts = await openCountsByServer([server.id]);
    const [lastRun] = await db
      .select({ startedAt: serverScanRuns.startedAt })
      .from(serverScanRuns)
      .where(eq(serverScanRuns.serverId, server.id))
      .orderBy(desc(serverScanRuns.startedAt))
      .limit(1);
    return c.json({
      ...publicServer(server),
      counts: counts.get(server.id) ?? emptyFindingCounts(),
      applications: apps,
      nextNucleiAt:
        server.nucleiSchedule && isValidSchedule(server.nucleiSchedule)
          ? (nextRunAt(
              server.nucleiSchedule,
              lastRun?.startedAt ?? null
            )?.toISOString() ?? null)
          : null,
      install: installInstructions(c),
    });
  })
  .put("/:id", zValidator("json", updateSchema), async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const body = c.req.valid("json");
    const patch: Partial<typeof servers.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.clientId !== undefined) {
      if (body.clientId) {
        const [cl] = await db
          .select({ id: clients.id })
          .from(clients)
          .where(
            and(
              eq(clients.id, body.clientId),
              eq(clients.organizationId, orgId)
            )
          );
        if (!cl) return c.json({ error: "Client not found" }, 404);
      }
      patch.clientId = body.clientId;
    }
    if (body.nucleiTargets !== undefined) {
      const targets = [...new Set(body.nucleiTargets.filter(Boolean))];
      for (const t of targets) {
        const valid = validateLiveUrl(t);
        if (!valid.ok) return c.json({ error: `${t}: ${valid.reason}` }, 400);
      }
      patch.nucleiTargets = targets;
    }
    if (body.nucleiSchedule !== undefined) {
      const schedule = body.nucleiSchedule?.trim() || null;
      if (schedule && !isValidSchedule(schedule)) {
        return c.json({ error: "Not a valid cron expression." }, 400);
      }
      patch.nucleiSchedule = schedule;
    }
    if (body.kumaMonitors !== undefined)
      patch.kumaMonitors = [...new Set(body.kumaMonitors)];
    if (body.wazuhAgentId !== undefined) patch.wazuhAgentId = body.wazuhAgentId;
    if (body.address !== undefined) {
      const addr = body.address?.trim() || null;
      if (addr) {
        const resolved = await resolveAddress(addr);
        if (!resolved.ok) return c.json({ error: resolved.reason }, 400);
      }
      patch.address = addr;
      if (!addr) patch.networkState = null;
    }
    if (body.backupChecks !== undefined) patch.backupChecks = body.backupChecks;
    if (body.storageChecks !== undefined)
      patch.storageChecks = body.storageChecks;
    if (body.expectedPorts !== undefined)
      patch.expectedPorts = [...new Set(body.expectedPorts)].sort(
        (a, b) => a - b
      );
    for (const key of [
      "cpuThreshold",
      "memoryThreshold",
      "diskThreshold",
    ] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (Object.keys(patch).length) {
      await db.update(servers).set(patch).where(eq(servers.id, server.id));
    }

    if (body.repositoryIds !== undefined) {
      // Only this organization's repositories can be linked, whatever ids
      // the client sends.
      const ids = body.repositoryIds;
      await db
        .update(repositories)
        .set({ serverId: null })
        .where(
          and(
            eq(repositories.organizationId, orgId),
            eq(repositories.serverId, server.id)
          )
        );
      if (ids.length) {
        await db
          .update(repositories)
          .set({ serverId: server.id })
          .where(
            and(
              eq(repositories.organizationId, orgId),
              inArray(repositories.id, ids)
            )
          );
      }
    }
    // Which monitors belong here just changed: pull Kuma now instead of
    // leaving the page empty until the scheduler's next tick.
    if (body.kumaMonitors !== undefined || body.repositoryIds !== undefined) {
      await syncKumaForOrg(orgId).catch((e) =>
        console.error("[servers] Kuma sync after save failed:", e)
      );
    }
    if (body.address !== undefined || body.expectedPorts !== undefined) {
      if (patch.address === null) {
        await syncFindings(server.id, "network", []);
      } else {
        await runNetworkCheck(server.id).catch((e) =>
          console.error("[servers] network check after save failed:", e)
        );
      }
    }
    const [fresh] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, server.id));
    await audit(c, "server.update", srv(server), {
      fields: Object.keys(body),
    });
    return c.json(publicServer(fresh!));
  })
  .delete("/:id", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can remove servers."
    );
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    await db.delete(servers).where(eq(servers.id, server.id));
    await audit(c, "server.delete", srv(server));
    return c.json({ deleted: true });
  })
  .post("/:id/enrollment", async (c) => {
    const orgId = await requireOrgAdmin(c, TOKEN_ADMIN_ONLY);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    await audit(c, "server.install_code", srv(server));
    return c.json({
      enrollment: await issueEnrollment(server.id),
      install: installInstructions(c),
    });
  })
  .delete("/:id/token", async (c) => {
    const orgId = await requireOrgAdmin(c, TOKEN_ADMIN_ONLY);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    await db
      .update(servers)
      .set({
        agentTokenHash: null,
        agentTokenPrefix: null,
        agentTokenCreatedAt: null,
        enrollmentCodeHash: null,
        enrollmentExpiresAt: null,
      })
      .where(eq(servers.id, server.id));
    await audit(c, "server.token_revoke", srv(server));
    return c.json({ revoked: true });
  })
  .get("/:id/findings", zValidator("query", findingsQuery), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const q = c.req.valid("query");
    const where = [
      eq(serverFindings.serverId, server.id),
      q.status === "open"
        ? isNull(serverFindings.resolvedAt)
        : isNotNull(serverFindings.resolvedAt),
    ];
    if (q.source) where.push(eq(serverFindings.source, q.source));
    if (q.prefix)
      where.push(
        like(
          serverFindings.fingerprint,
          `${q.prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
        )
      );
    const rows = await db
      .select()
      .from(serverFindings)
      .where(and(...where))
      .orderBy(
        q.status === "open"
          ? desc(serverFindings.lastSeenAt)
          : desc(serverFindings.resolvedAt)
      )
      .limit(q.status === "open" ? 5000 : 500);
    return c.json(rows);
  })
  .get("/:id/metrics", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const hours = Math.min(
      Math.max(Number(c.req.query("hours")) || 24, 1),
      336
    );
    const rows = await db
      .select({
        recordedAt: serverMetrics.recordedAt,
        cpuPct: serverMetrics.cpuPct,
        memoryPct: serverMetrics.memoryPct,
        diskPct: serverMetrics.diskPct,
      })
      .from(serverMetrics)
      .where(
        and(
          eq(serverMetrics.serverId, server.id),
          gte(
            serverMetrics.recordedAt,
            new Date(Date.now() - hours * 3600 * 1000)
          )
        )
      )
      .orderBy(asc(serverMetrics.recordedAt));
    return c.json(rows);
  })
  .get("/:id/container-metrics", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const app = (c.req.query("app") ?? "").slice(0, 200);
    if (!app) return c.json({ error: "app is required" }, 400);
    const hours = Math.min(
      Math.max(Number(c.req.query("hours")) || 24, 1),
      192
    );
    const rows = await db
      .select({
        recordedAt: containerMetrics.recordedAt,
        memBytes: containerMetrics.memBytes,
        cpuPct: containerMetrics.cpuPct,
      })
      .from(containerMetrics)
      .where(
        and(
          eq(containerMetrics.serverId, server.id),
          eq(containerMetrics.app, app),
          gte(
            containerMetrics.recordedAt,
            new Date(Date.now() - hours * 3600 * 1000)
          )
        )
      )
      .orderBy(asc(containerMetrics.recordedAt));
    return c.json(rows);
  })
  .get("/:id/scan-runs", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const rows = await db
      .select()
      .from(serverScanRuns)
      .where(eq(serverScanRuns.serverId, server.id))
      .orderBy(desc(serverScanRuns.startedAt))
      .limit(10);
    return c.json(rows);
  })
  .post("/:id/access/accept", async (c) => {
    // Accepting access is granting it: owner/admin, with 2FA, audited.
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can accept new access."
    );
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const access = (server.lastReport as { access?: unknown } | null)?.access;
    if (!access) {
      return c.json({ error: "The agent has not reported access yet." }, 400);
    }
    const baseline = accessIdentities(
      access as Parameters<typeof accessIdentities>[0]
    );
    const before = (server.accessBaseline ?? {
      keys: [],
      groups: [],
      uid0: [],
    }) as typeof baseline;
    await db
      .update(servers)
      .set({ accessBaseline: baseline })
      .where(eq(servers.id, server.id));
    // Close the "new key" findings now instead of at the next report.
    await syncFindings(
      server.id,
      "security",
      (
        await db
          .select()
          .from(serverFindings)
          .where(
            and(
              eq(serverFindings.serverId, server.id),
              eq(serverFindings.source, "security"),
              isNull(serverFindings.resolvedAt)
            )
          )
      )
        .filter((f) => !f.fingerprint.startsWith("access:"))
        .map((f) => ({
          fingerprint: f.fingerprint,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          target: f.target,
          reference: f.reference,
        }))
    );
    await audit(c, "server.access_accept", srv(server), {
      keys: baseline.keys.filter((k) => !before.keys.includes(k)),
      groups: baseline.groups.filter((g) => !before.groups.includes(g)),
      uid0: baseline.uid0.filter((u) => !before.uid0.includes(u)),
    });
    return c.json({ accepted: true });
  })
  .post("/:id/network-check", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    if (!server.address) {
      return c.json({ error: "Set an IP address or hostname first." }, 400);
    }
    return c.json(await runNetworkCheck(server.id));
  })
  // Errors the server's containers logged; ?app= narrows to one.
  .get("/:id/errors", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const hours = Math.min(
      168,
      Math.max(1, Number(c.req.query("hours")) || 24)
    );
    const app = c.req.query("app") || undefined;
    return c.json(await errorSummary({ serverId: server.id, app }, hours));
  })
  // Each image the server runs, against Docker Hub: maintained, newer build.
  .get("/:id/images", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    return c.json({ images: await imageStatuses(server.lastReport) });
  })
  // Which containers Dokploy runs — those get a redeploy button.
  .get("/:id/container-services", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const res = await containerServices(orgId, reportedContainers(server));
    if (!res.ok) return c.json({ services: {}, error: res.error });
    return c.json({ services: res.services });
  })
  // Redeploy a container through Dokploy. The agent stays push-only: the
  // command goes to Dokploy, never to the server.
  .post(
    "/:id/containers/redeploy",
    zValidator("json", z.object({ app: z.string().min(1).max(200) })),
    async (c) => {
      const orgId = requireSession(c);
      if (orgId instanceof Response) return orgId;
      const server = await loadServer(c, orgId);
      if (!server) return c.json({ error: "Server not found" }, 404);
      const { app } = c.req.valid("json");
      const res = await redeployContainer(
        orgId,
        reportedContainers(server),
        app
      );
      if (!res.ok) return c.json({ error: res.error }, res.status);
      await audit(c, "server.container_redeploy", srv(server), {
        app,
        service: res.service.name,
        kind: res.service.kind,
      });
      return c.json(res);
    }
  )
  // Free disk space through Dokploy: build cache or unused images.
  .post(
    "/:id/docker-cleanup",
    zValidator(
      "json",
      z.object({ what: z.enum(["builder", "images", "containers"]) })
    ),
    async (c) => {
      const orgId = requireSession(c);
      if (orgId instanceof Response) return orgId;
      const server = await loadServer(c, orgId);
      if (!server) return c.json({ error: "Server not found" }, 404);
      const { what } = c.req.valid("json");
      const rows = await db
        .select({
          id: servers.id,
          lastReport: servers.lastReport,
          address: servers.address,
        })
        .from(servers)
        .where(eq(servers.organizationId, orgId));
      const res = await cleanServerDocker(orgId, server.id, rows, what);
      if (!res.ok) return c.json({ error: res.error }, res.status);
      await audit(c, "server.docker_cleanup", srv(server), { what });
      return c.json({ ok: true });
    }
  )
  .post("/:id/nuclei", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const server = await loadServer(c, orgId);
    if (!server) return c.json({ error: "Server not found" }, 404);
    const runId = await startNucleiRun(server.id);
    await audit(c, "server.nuclei_scan", srv(server));
    return c.json({ runId }, 202);
  });
