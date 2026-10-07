import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  auditLog,
  member,
  orgIntegrations,
  repositories,
  scans,
  serverFindings,
  servers,
  user,
  vulnerabilities,
} from "db";
import { STALE_AFTER_MS } from "./server-scheduler";
import { startNucleiRun } from "./nuclei";
import { runScan } from "./scan";

type Args = Record<string, unknown>;

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** "read" for everything; "scan" may start scans. */
  scope: "read" | "scan";
  run: (orgId: string, args: Args) => Promise<unknown>;
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  moderate: 2,
  low: 3,
  info: 4,
};

function str(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(args: Args, key: string, fallback: number, max: number): number {
  const v = Number(args[key]);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : fallback;
}

/** A server by id or (case-insensitive, partial) name, within the org only. */
async function findServer(orgId: string, ref: string) {
  const rows = await db
    .select()
    .from(servers)
    .where(
      and(
        eq(servers.organizationId, orgId),
        /^[0-9a-f-]{36}$/i.test(ref)
          ? eq(servers.id, ref)
          : ilike(servers.name, `%${ref.replace(/[%_]/g, "")}%`)
      )
    )
    .limit(5);
  if (rows.length === 0) throw new Error(`No server matches "${ref}".`);
  const exact = rows.find((s) => s.name.toLowerCase() === ref.toLowerCase());
  if (!exact && rows.length > 1) {
    throw new Error(
      `"${ref}" matches several servers: ${rows.map((s) => s.name).join(", ")}. Be more specific.`
    );
  }
  return exact ?? rows[0]!;
}

async function findRepo(orgId: string, ref: string) {
  const rows = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, orgId),
        /^[0-9a-f-]{36}$/i.test(ref)
          ? eq(repositories.id, ref)
          : ilike(repositories.name, `%${ref.replace(/[%_]/g, "")}%`)
      )
    )
    .limit(5);
  if (rows.length === 0) throw new Error(`No repository matches "${ref}".`);
  const exact = rows.find((r) => r.name.toLowerCase() === ref.toLowerCase());
  if (!exact && rows.length > 1) {
    throw new Error(
      `"${ref}" matches several repositories: ${rows.map((r) => r.name).join(", ")}.`
    );
  }
  return exact ?? rows[0]!;
}

function serverSummary(s: typeof servers.$inferSelect) {
  const r = (s.lastReport ?? {}) as {
    host?: { cpuPct?: number; memoryPct?: number; diskPct?: number | null };
    updates?: { pending?: number; security?: number; rebootRequired?: boolean };
  };
  const silent =
    !s.lastReportAt || Date.now() - s.lastReportAt.getTime() > STALE_AFTER_MS;
  return {
    id: s.id,
    name: s.name,
    os: s.os,
    address: s.address,
    agent: !s.lastReportAt ? "not installed" : silent ? "silent" : "reporting",
    agentVersion: s.agentVersion,
    lastReportAt: s.lastReportAt,
    cpuPct: r.host?.cpuPct != null ? Math.round(r.host.cpuPct) : null,
    memoryPct: r.host?.memoryPct != null ? Math.round(r.host.memoryPct) : null,
    diskPct: r.host?.diskPct != null ? Math.round(r.host.diskPct) : null,
    pendingUpdates: r.updates?.pending ?? null,
    securityUpdates: r.updates?.security ?? null,
    rebootRequired: r.updates?.rebootRequired ?? null,
  };
}

async function openFindings(
  serverIds: string[],
  filter: { source?: string; minSeverity?: string } = {},
  limit = 50
) {
  if (serverIds.length === 0) return [];
  const where = [
    inArray(serverFindings.serverId, serverIds),
    isNull(serverFindings.resolvedAt),
  ];
  if (filter.source)
    where.push(
      eq(
        serverFindings.source,
        filter.source as (typeof serverFindings.$inferSelect)["source"]
      )
    );
  const rows = await db
    .select()
    .from(serverFindings)
    .where(and(...where));
  const max = SEVERITY_RANK[filter.minSeverity ?? "info"] ?? 4;
  return rows
    .filter((f) => (SEVERITY_RANK[f.severity] ?? 4) <= max)
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4) ||
        b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
    )
    .slice(0, limit)
    .map((f) => ({
      severity: f.severity,
      source: f.source,
      title: f.title,
      target: f.target,
      detail: f.detail?.slice(0, 500) ?? null,
      fixAvailable: f.fixAvailable,
      fixesItselfAt: f.autoFixAt,
      since: f.firstSeenAt,
      serverId: f.serverId,
    }));
}

async function latestVulns(repoId: string) {
  const all = await db
    .select()
    .from(scans)
    .where(and(eq(scans.repositoryId, repoId), eq(scans.status, "success")))
    .orderBy(desc(scans.startedAt))
    .limit(20);
  const live = all.find((s) => s.target === "live");
  const branch = all.find((s) => s.target !== "live");
  const load = async (scanId?: string) =>
    scanId
      ? db
          .select()
          .from(vulnerabilities)
          .where(eq(vulnerabilities.scanId, scanId))
      : [];
  return {
    live,
    branch,
    liveVulns: await load(live?.id),
    branchVulns: await load(branch?.id),
  };
}

const severityEnum = {
  type: "string",
  enum: ["critical", "high", "medium", "low", "info"],
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "get_overview",
    scope: "read",
    description:
      "Security overview of the organization: servers (reporting/silent), open findings by severity, the most severe open problems, applications with critical/high CVEs in their deployed version, monitors down.",
    inputSchema: { type: "object", properties: {} },
    async run(orgId) {
      const srv = await db
        .select()
        .from(servers)
        .where(eq(servers.organizationId, orgId));
      const ids = srv.map((s) => s.id);
      const findings = await openFindings(ids, {}, 1000);
      const bySeverity: Record<string, number> = {};
      for (const f of findings)
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      const names = new Map(srv.map((s) => [s.id, s.name]));
      const repos = await db
        .select({ id: repositories.id, name: repositories.name })
        .from(repositories)
        .where(eq(repositories.organizationId, orgId));
      const apps = [];
      for (const r of repos) {
        const v = await latestVulns(r.id);
        const list = v.live ? v.liveVulns : v.branchVulns;
        const critical = list.filter((x) => x.severity === "critical").length;
        const high = list.filter((x) => x.severity === "high").length;
        if (critical || high)
          apps.push({
            name: r.name,
            critical,
            high,
            measuredOn: v.live ? "deployed commit" : "branch",
          });
      }
      const [integ] = await db
        .select({ kumaState: orgIntegrations.kumaState })
        .from(orgIntegrations)
        .where(eq(orgIntegrations.organizationId, orgId));
      const monitors =
        (
          integ?.kumaState as {
            monitors?: Array<{ name: string; status: number | null }>;
          } | null
        )?.monitors ?? [];
      return {
        servers: srv
          .map(serverSummary)
          .map((s) => ({ name: s.name, agent: s.agent })),
        openFindings: bySeverity,
        mostSevere: findings
          .filter((f) => !f.fixesItselfAt)
          .slice(0, 10)
          .map((f) => ({
            ...f,
            server: names.get(f.serverId),
            serverId: undefined,
          })),
        applicationsWithCriticalOrHighCves: apps,
        monitorsDown: monitors.filter((m) => m.status === 0).map((m) => m.name),
      };
    },
  },
  {
    name: "list_servers",
    scope: "read",
    description:
      "All servers with agent status, OS, load/memory/disk in percent, pending and security updates, reboot required, and open findings per severity.",
    inputSchema: { type: "object", properties: {} },
    async run(orgId) {
      const srv = await db
        .select()
        .from(servers)
        .where(eq(servers.organizationId, orgId));
      const findings = await openFindings(
        srv.map((s) => s.id),
        {},
        5000
      );
      return srv.map((s) => {
        const mine = findings.filter((f) => f.serverId === s.id);
        const counts: Record<string, number> = {};
        for (const f of mine)
          counts[f.severity] = (counts[f.severity] ?? 0) + 1;
        return { ...serverSummary(s), openFindings: counts };
      });
    },
  },
  {
    name: "get_server",
    scope: "read",
    description:
      "One server in detail: system, updates and automatic updates, CrowdSec, Docker apps (containers, services), backups, external port check, and its open findings.",
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Server name (or part of it) or id",
        },
      },
      required: ["server"],
    },
    async run(orgId, args) {
      const ref = str(args, "server");
      if (!ref) throw new Error("server is required");
      const s = await findServer(orgId, ref);
      const r = (s.lastReport ?? {}) as Record<string, unknown>;
      return {
        ...serverSummary(s),
        updates: r.updates ?? null,
        crowdsec: r.crowdsec ?? null,
        containers: r.containers ?? null,
        services: r.services ?? null,
        backups: r.backups ?? null,
        trivy: r.trivy ?? null,
        externalCheck: s.networkState ?? null,
        uptimeMonitors:
          (s.kumaState as { monitors?: unknown[] } | null)?.monitors ?? null,
        openFindings: await openFindings([s.id], {}, 100),
      };
    },
  },
  {
    name: "list_findings",
    scope: "read",
    description:
      "Open findings across all servers, most severe first. Filter by server, source (host, trivy, crowdsec, nuclei, kuma, wazuh, network, heartbeat) and minimum severity.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", description: "Server name or id (optional)" },
        source: {
          type: "string",
          enum: [
            "host",
            "trivy",
            "crowdsec",
            "nuclei",
            "kuma",
            "wazuh",
            "network",
            "heartbeat",
          ],
        },
        min_severity: severityEnum,
        limit: { type: "number", description: "Default 50, at most 500" },
      },
    },
    async run(orgId, args) {
      const ref = str(args, "server");
      const srv = ref
        ? [await findServer(orgId, ref)]
        : await db
            .select()
            .from(servers)
            .where(eq(servers.organizationId, orgId));
      const names = new Map(srv.map((s) => [s.id, s.name]));
      const rows = await openFindings(
        srv.map((s) => s.id),
        { source: str(args, "source"), minSeverity: str(args, "min_severity") },
        num(args, "limit", 50, 500)
      );
      return rows.map((f) => ({
        ...f,
        server: names.get(f.serverId),
        serverId: undefined,
      }));
    },
  },
  {
    name: "list_uptime",
    scope: "read",
    description:
      "Uptime Kuma monitors with status, response time and TLS certificate days left.",
    inputSchema: {
      type: "object",
      properties: {
        problems_only: {
          type: "boolean",
          description: "Only down/retrying monitors and expiring certificates",
        },
      },
    },
    async run(orgId, args) {
      const [integ] = await db
        .select({ kumaState: orgIntegrations.kumaState })
        .from(orgIntegrations)
        .where(eq(orgIntegrations.organizationId, orgId));
      const state = integ?.kumaState as {
        checkedAt?: string;
        monitors?: Array<Record<string, unknown>>;
      } | null;
      let monitors = (state?.monitors ?? []).map((m) => ({
        name: m.name,
        url: m.url,
        status: m.statusLabel,
        responseTimeMs: m.responseTimeMs,
        certDaysRemaining: m.certDaysRemaining,
      }));
      if (args.problems_only === true) {
        monitors = monitors.filter(
          (m) =>
            m.status !== "up" ||
            (typeof m.certDaysRemaining === "number" &&
              m.certDaysRemaining <= 21)
        );
      }
      return { checkedAt: state?.checkedAt ?? null, monitors };
    },
  },
  {
    name: "list_repositories",
    scope: "read",
    description:
      "Repositories with their CVE counts: on the deployed commit (live scan) and on the branch, and how many are fixed on the branch but still deployed.",
    inputSchema: { type: "object", properties: {} },
    async run(orgId) {
      const repos = await db
        .select()
        .from(repositories)
        .where(eq(repositories.organizationId, orgId));
      const out = [];
      for (const r of repos) {
        const v = await latestVulns(r.id);
        const count = (list: typeof v.liveVulns) => {
          const c: Record<string, number> = {};
          for (const x of list) c[x.severity] = (c[x.severity] ?? 0) + 1;
          return c;
        };
        const branchKeys = new Set(
          v.branchVulns.map((x) => x.ghsaId ?? `${x.packageName}:${x.title}`)
        );
        out.push({
          name: r.name,
          githubUrl: r.githubUrl,
          liveUrl: r.liveUrl,
          liveStatus: r.liveStatus,
          deployed: v.live
            ? {
                commit: v.live.ref,
                scannedAt: v.live.startedAt,
                cves: count(v.liveVulns),
              }
            : null,
          branch: v.branch
            ? {
                ref: v.branch.ref,
                scannedAt: v.branch.startedAt,
                cves: count(v.branchVulns),
              }
            : null,
          fixedOnBranchButDeployed: v.live
            ? v.liveVulns.filter(
                (x) =>
                  !branchKeys.has(x.ghsaId ?? `${x.packageName}:${x.title}`)
              ).length
            : null,
        });
      }
      return out;
    },
  },
  {
    name: "get_repository",
    scope: "read",
    description:
      "One repository's vulnerabilities (deployed version if scanned, else branch) with package, severity, fix availability and advisory link.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", description: "Repository name or id" },
      },
      required: ["repository"],
    },
    async run(orgId, args) {
      const ref = str(args, "repository");
      if (!ref) throw new Error("repository is required");
      const r = await findRepo(orgId, ref);
      const v = await latestVulns(r.id);
      const list = v.live ? v.liveVulns : v.branchVulns;
      return {
        name: r.name,
        measuredOn: v.live
          ? `deployed commit ${v.live.ref}`
          : v.branch
            ? `branch ${v.branch.ref}`
            : "never scanned",
        vulnerabilities: list
          .sort(
            (a, b) =>
              (SEVERITY_RANK[a.severity] ?? 4) -
              (SEVERITY_RANK[b.severity] ?? 4)
          )
          .map((x) => ({
            package: x.packageName,
            severity: x.severity,
            title: x.title,
            advisory: x.ghsaId ?? x.cveId,
            url: x.url,
            vulnerableRange: x.vulnerableRange,
            fixAvailable: x.fixAvailable,
            fixIsMajor: x.fixIsSemverMajor,
            direct: x.isDirect,
          })),
      };
    },
  },
  {
    name: "list_members",
    scope: "read",
    description:
      "Members of the organization with role and whether two-factor authentication is on.",
    inputSchema: { type: "object", properties: {} },
    async run(orgId) {
      return db
        .select({
          email: user.email,
          name: user.name,
          role: member.role,
          twoFactorEnabled: user.twoFactorEnabled,
          memberSince: member.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, orgId));
    },
  },
  {
    name: "get_audit_log",
    scope: "read",
    description:
      "Recent security-relevant actions: who did what, when and from which IP.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 50, at most 200" },
      },
    },
    async run(orgId, args) {
      const memberIds = (
        await db
          .select({ userId: member.userId })
          .from(member)
          .where(eq(member.organizationId, orgId))
      ).map((m) => m.userId);
      return db
        .select({
          at: auditLog.createdAt,
          action: auditLog.action,
          user: auditLog.userEmail,
          target: auditLog.targetName,
          detail: auditLog.detail,
          ip: auditLog.ip,
        })
        .from(auditLog)
        .where(
          memberIds.length
            ? or(
                eq(auditLog.organizationId, orgId),
                and(
                  isNull(auditLog.organizationId),
                  inArray(auditLog.userId, memberIds)
                )
              )
            : eq(auditLog.organizationId, orgId)
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(num(args, "limit", 50, 200));
    },
  },
  {
    name: "start_nuclei_scan",
    scope: "scan",
    description:
      "Start a Nuclei scan of a server's live applications and open ports (non-intrusive templates only). Needs a key with the scan permission.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", description: "Server name or id" },
      },
      required: ["server"],
    },
    async run(orgId, args) {
      const ref = str(args, "server");
      if (!ref) throw new Error("server is required");
      const s = await findServer(orgId, ref);
      const runId = await startNucleiRun(s.id);
      return {
        started: true,
        server: s.name,
        runId,
        note: "A scan takes 10–25 minutes; findings appear when it finishes.",
      };
    },
  },
  {
    name: "start_repository_scan",
    scope: "scan",
    description:
      "Re-scan a repository's dependencies for outdated packages and CVEs. Needs a key with the scan permission.",
    inputSchema: {
      type: "object",
      properties: {
        repository: { type: "string", description: "Repository name or id" },
      },
      required: ["repository"],
    },
    async run(orgId, args) {
      const ref = str(args, "repository");
      if (!ref) throw new Error("repository is required");
      const r = await findRepo(orgId, ref);
      const [scan] = await db
        .insert(scans)
        .values({ repositoryId: r.id, status: "pending" })
        .returning({ id: scans.id });
      runScan(r.id, scan!.id).catch((e) =>
        console.error("[mcp] scan failed:", e)
      );
      return { started: true, repository: r.name, scanId: scan!.id };
    },
  },
];
