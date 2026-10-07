import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
} from "drizzle-orm";
import {
  db,
  organization,
  orgIntegrations,
  repositories,
  scans,
  serverFindings,
  servers,
  vulnerabilities,
} from "db";
import { notify } from "../lib/notify";
import { STALE_AFTER_MS } from "./server-scheduler";

const DAY = 24 * 60 * 60 * 1000;

export type DigestData = {
  orgName: string;
  servers: { total: number; silent: string[] };
  open: Record<"critical" | "high" | "medium" | "low", number>;
  newThisWeek: number;
  resolvedThisWeek: number;
  top: Array<{ severity: string; title: string; server: string }>;
  appsWithCriticalCves: Array<{ name: string; critical: number; high: number }>;
  monitorsDown: string[];
  certsExpiring: Array<{ name: string; days: number }>;
};

/**
 * One message a week: what is open, what changed, what is silent. Short
 * enough for Telegram, complete enough that nothing important hides.
 */
export function formatDigest(d: DigestData): {
  title: string;
  message: string;
} {
  const lines: string[] = [];
  const openTotal = d.open.critical + d.open.high + d.open.medium + d.open.low;
  lines.push(
    `Open: ${d.open.critical} critical · ${d.open.high} high · ${d.open.medium} medium · ${d.open.low} low`
  );
  lines.push(
    `This week: ${d.newThisWeek} new · ${d.resolvedThisWeek} resolved`
  );
  if (d.servers.total) {
    lines.push(
      `Servers: ${d.servers.total - d.servers.silent.length}/${d.servers.total} reporting` +
        (d.servers.silent.length
          ? ` — silent: ${d.servers.silent.join(", ")}`
          : "")
    );
  }
  if (d.top.length) {
    lines.push("", "Most severe:");
    for (const t of d.top) {
      lines.push(`• [${t.severity.toUpperCase()}] ${t.title} — ${t.server}`);
    }
  }
  if (d.appsWithCriticalCves.length) {
    lines.push("", "Applications with critical/high CVEs:");
    for (const a of d.appsWithCriticalCves) {
      lines.push(`• ${a.name}: ${a.critical} critical, ${a.high} high`);
    }
  }
  if (d.monitorsDown.length) {
    lines.push("", `Down right now: ${d.monitorsDown.join(", ")}`);
  }
  if (d.certsExpiring.length) {
    lines.push(
      "",
      `Certificates expiring: ${d.certsExpiring.map((c) => `${c.name} (${c.days}d)`).join(", ")}`
    );
  }
  if (openTotal === 0 && !d.servers.silent.length && !d.monitorsDown.length) {
    lines.push("", "✅ Nothing open — all quiet.");
  }
  return {
    title: `Weekly security summary — ${d.orgName}`,
    message: lines.join("\n"),
  };
}

export async function collectDigest(
  orgId: string,
  now = Date.now()
): Promise<DigestData | null> {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId));
  if (!org) return null;
  const since = new Date(now - 7 * DAY);

  const orgServers = await db
    .select()
    .from(servers)
    .where(eq(servers.organizationId, orgId));
  const repos = await db
    .select({ id: repositories.id, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.organizationId, orgId));
  if (orgServers.length === 0 && repos.length === 0) return null;

  const ids = orgServers.map((s) => s.id);
  const names = new Map(orgServers.map((s) => [s.id, s.name]));
  const open = { critical: 0, high: 0, medium: 0, low: 0 };
  let top: DigestData["top"] = [];
  let newThisWeek = 0;
  let resolvedThisWeek = 0;
  if (ids.length) {
    const openRows = await db
      .select()
      .from(serverFindings)
      .where(
        and(
          inArray(serverFindings.serverId, ids),
          isNull(serverFindings.resolvedAt)
        )
      );
    for (const f of openRows) {
      if (f.severity in open) open[f.severity as keyof typeof open]++;
    }
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    top = openRows
      .filter(
        (f) =>
          (f.severity === "critical" || f.severity === "high") && !f.autoFixAt
      )
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .slice(0, 5)
      .map((f) => ({
        severity: f.severity,
        title: f.title,
        server: names.get(f.serverId) ?? "?",
      }));
    newThisWeek = (
      await db
        .select({ id: serverFindings.id })
        .from(serverFindings)
        .where(
          and(
            inArray(serverFindings.serverId, ids),
            gte(serverFindings.firstSeenAt, since)
          )
        )
    ).length;
    resolvedThisWeek = (
      await db
        .select({ id: serverFindings.id })
        .from(serverFindings)
        .where(
          and(
            inArray(serverFindings.serverId, ids),
            isNotNull(serverFindings.resolvedAt),
            gte(serverFindings.resolvedAt, since)
          )
        )
    ).length;
  }

  // Applications: critical/high in each repository's latest successful scan
  // (the deployed version when there is a live scan).
  const appsWithCriticalCves: DigestData["appsWithCriticalCves"] = [];
  for (const r of repos) {
    const [latest] = await db
      .select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.repositoryId, r.id), eq(scans.status, "success")))
      .orderBy(desc(scans.target), desc(scans.startedAt))
      .limit(1);
    if (!latest) continue;
    const vulns = await db
      .select({ severity: vulnerabilities.severity })
      .from(vulnerabilities)
      .where(eq(vulnerabilities.scanId, latest.id));
    const critical = vulns.filter((v) => v.severity === "critical").length;
    const high = vulns.filter((v) => v.severity === "high").length;
    if (critical || high)
      appsWithCriticalCves.push({ name: r.name, critical, high });
  }

  const [integ] = await db
    .select({ kumaState: orgIntegrations.kumaState })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId));
  const monitors = ((
    integ?.kumaState as { monitors?: Array<Record<string, unknown>> } | null
  )?.monitors ?? []) as Array<{
    name: string;
    status: number | null;
    certDaysRemaining: number | null;
  }>;

  return {
    orgName: org.name,
    servers: {
      total: orgServers.length,
      silent: orgServers
        .filter(
          (s) =>
            s.agentTokenHash &&
            (!s.lastReportAt || now - s.lastReportAt.getTime() > STALE_AFTER_MS)
        )
        .map((s) => s.name),
    },
    open,
    newThisWeek,
    resolvedThisWeek,
    top,
    appsWithCriticalCves: appsWithCriticalCves
      .sort((a, b) => b.critical - a.critical || b.high - a.high)
      .slice(0, 8),
    monitorsDown: monitors.filter((m) => m.status === 0).map((m) => m.name),
    certsExpiring: monitors
      .filter((m) => m.certDaysRemaining != null && m.certDaysRemaining <= 14)
      .map((m) => ({ name: m.name, days: Math.floor(m.certDaysRemaining!) })),
  };
}

/**
 * Mondays from 07:00 UTC, once per organization and week. lastDigestAt is
 * stored, so a restart on Monday morning does not send it twice.
 */
export async function sendDueDigests(now = new Date()): Promise<void> {
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 7) return;
  const due = await db
    .select({
      organizationId: orgIntegrations.organizationId,
      lastDigestAt: orgIntegrations.lastDigestAt,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.weeklyDigest, true));
  for (const o of due) {
    if (o.lastDigestAt && now.getTime() - o.lastDigestAt.getTime() < 6 * DAY)
      continue;
    // Claim the week first: a crash halfway must not send it again and again.
    const claimed = await db
      .update(orgIntegrations)
      .set({ lastDigestAt: now })
      .where(
        and(
          eq(orgIntegrations.organizationId, o.organizationId),
          o.lastDigestAt
            ? lt(
                orgIntegrations.lastDigestAt,
                new Date(now.getTime() - 6 * DAY)
              )
            : isNull(orgIntegrations.lastDigestAt)
        )
      )
      .returning({ id: orgIntegrations.id });
    if (claimed.length === 0) continue;
    const data = await collectDigest(o.organizationId, now.getTime());
    if (!data) continue;
    const { title, message } = formatDigest(data);
    const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
    await notify(o.organizationId, {
      type: "weekly_digest",
      title,
      message,
      url: appUrl ? `${appUrl}/monitoring` : undefined,
    });
  }
}
