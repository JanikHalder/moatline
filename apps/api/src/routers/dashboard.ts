import { Hono } from "hono";
import { eq, and, inArray, desc, isNull, sql } from "drizzle-orm";
import {
  db,
  repositories,
  scans,
  vulnerabilities,
  servers,
  serverFindings,
} from "db";
import { emptyFindingCounts, openCountsByServer } from "../lib/server-findings";
import { STALE_AFTER_MS } from "../services/server-scheduler";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization } from "../middleware/tenant";

type SeverityCounts = {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
};

function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 };
}

type VulnRow = typeof vulnerabilities.$inferSelect;

/** Advisory identity, the same as the web's live-gap comparison. */
function advisoryKey(v: VulnRow): string {
  if (v.ghsaId) return `ghsa:${v.ghsaId}`;
  if (v.cveId) return `${v.packageName}:${v.cveId}`;
  return `${v.packageName}:${v.title ?? v.severity}`;
}

function countVulns(rows: VulnRow[]): SeverityCounts {
  const c = emptyCounts();
  for (const v of rows) {
    const sev = v.severity as keyof SeverityCounts;
    if (sev in c && sev !== "total") {
      c[sev] += 1;
      c.total += 1;
    }
  }
  return c;
}

function addCounts(into: SeverityCounts, from: SeverityCounts): void {
  for (const k of Object.keys(into) as (keyof SeverityCounts)[]) {
    into[k] += from[k];
  }
}

/**
 * Org-wide security overview.
 *
 * Exposure is measured on what is *deployed*: for a repository whose live URL
 * reports a commit, the latest scan of that commit counts, not the branch.
 * A CVE fixed on main but still served is open — the branch-only view would
 * report it as fixed. Repositories without a live scan fall back to the
 * branch, and say so (`exposureSource`).
 */
export const dashboardRouter = new Hono<{ Variables: TenantVariables }>().get(
  "/",
  async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;

    const orgRepos = await db
      .select()
      .from(repositories)
      .where(eq(repositories.organizationId, orgId));
    const serverSummary = await summarizeServers(orgId);
    if (orgRepos.length === 0) {
      return c.json({
        totals: emptyCounts(),
        branchTotals: emptyCounts(),
        liveCoverage: { live: 0, total: 0 },
        fixedNotDeployed: 0,
        repos: [],
        servers: serverSummary,
      });
    }
    const repoIds = orgRepos.map((r) => r.id);

    const successScans = await db
      .select()
      .from(scans)
      .where(
        and(inArray(scans.repositoryId, repoIds), eq(scans.status, "success"))
      )
      .orderBy(desc(scans.startedAt));

    type ScanRow = (typeof successScans)[number];
    const branchScan = new Map<string, ScanRow>();
    const liveScan = new Map<string, ScanRow>();
    for (const s of successScans) {
      const map = s.target === "live" ? liveScan : branchScan;
      if (!map.has(s.repositoryId)) map.set(s.repositoryId, s);
    }
    const scanIds = [
      ...[...branchScan.values()].map((s) => s.id),
      ...[...liveScan.values()].map((s) => s.id),
    ];
    const vulnRows = scanIds.length
      ? await db
          .select()
          .from(vulnerabilities)
          .where(inArray(vulnerabilities.scanId, scanIds))
      : [];
    const vulnsByScan = new Map<string, VulnRow[]>();
    for (const v of vulnRows) {
      const list = vulnsByScan.get(v.scanId) ?? [];
      list.push(v);
      vulnsByScan.set(v.scanId, list);
    }

    // Open findings on the live applications themselves (Nuclei, Kuma).
    const appFindings = await db
      .select({
        repositoryId: serverFindings.repositoryId,
        severity: serverFindings.severity,
        n: sql<number>`count(*)::int`,
      })
      .from(serverFindings)
      .where(
        and(
          inArray(serverFindings.repositoryId, repoIds),
          isNull(serverFindings.resolvedAt)
        )
      )
      .groupBy(serverFindings.repositoryId, serverFindings.severity);
    const appCounts = new Map<string, Record<string, number>>();
    for (const r of appFindings) {
      if (!r.repositoryId) continue;
      const m = appCounts.get(r.repositoryId) ?? { total: 0 };
      m[r.severity] = (m[r.severity] ?? 0) + r.n;
      m.total = (m.total ?? 0) + r.n;
      appCounts.set(r.repositoryId, m);
    }

    const totals = emptyCounts();
    const branchTotals = emptyCounts();
    let fixedNotDeployedTotal = 0;
    let liveCovered = 0;

    const repos = orgRepos
      .map((r) => {
        const branch = branchScan.get(r.id);
        const live = liveScan.get(r.id);
        const branchVulns = branch ? (vulnsByScan.get(branch.id) ?? []) : [];
        const liveVulns = live ? (vulnsByScan.get(live.id) ?? []) : null;
        const branchCounts = countVulns(branchVulns);
        const liveCounts = liveVulns ? countVulns(liveVulns) : null;
        let fixedNotDeployed = 0;
        if (liveVulns && branch) {
          const onBranch = new Set(branchVulns.map(advisoryKey));
          fixedNotDeployed = liveVulns.filter(
            (v) => !onBranch.has(advisoryKey(v))
          ).length;
        }
        const exposure = liveCounts ?? branchCounts;
        addCounts(totals, exposure);
        addCounts(branchTotals, branchCounts);
        fixedNotDeployedTotal += fixedNotDeployed;
        if (live) liveCovered++;
        const lastScan = branch ?? live;
        return {
          repositoryId: r.id,
          name: r.name,
          githubUrl: r.githubUrl,
          autoFixCritical: r.autoFixCritical,
          autoDeploy: r.autoDeploy,
          lastScanAt: lastScan?.startedAt ?? r.lastScannedAt ?? null,
          lastScanId: lastScan?.id ?? null,
          scanned: !!(branch || live),
          // What is exposed: the deployed version when known, else the branch.
          counts: exposure,
          exposureSource: live ? ("live" as const) : ("branch" as const),
          branchCounts,
          liveCounts,
          liveScanAt: live?.startedAt ?? null,
          liveCommit: live?.ref ?? r.liveCommit ?? null,
          liveUrl: r.liveUrl,
          liveStatus: r.liveStatus,
          fixedNotDeployed,
          appFindings: appCounts.get(r.id) ?? { total: 0 },
          serverId: r.serverId,
        };
      })
      // worst exposure first
      .sort((a, b) => {
        const w = (x: typeof a) =>
          x.counts.critical * 1000 +
          x.counts.high * 10 +
          x.counts.total +
          (x.appFindings.critical ?? 0) * 1000 +
          (x.appFindings.high ?? 0) * 10;
        return w(b) - w(a);
      });

    return c.json({
      totals,
      branchTotals,
      liveCoverage: { live: liveCovered, total: orgRepos.length },
      fixedNotDeployed: fixedNotDeployedTotal,
      repos,
      servers: serverSummary,
    });
  }
);

async function summarizeServers(orgId: string) {
  const rows = await db
    .select({ id: servers.id, lastReportAt: servers.lastReportAt })
    .from(servers)
    .where(eq(servers.organizationId, orgId));
  const counts = await openCountsByServer(rows.map((r) => r.id));
  const findings = emptyFindingCounts();
  for (const c of counts.values()) {
    for (const k of Object.keys(findings) as (keyof typeof findings)[]) {
      findings[k] += c[k];
    }
  }
  const now = Date.now();
  let reporting = 0;
  let stale = 0;
  let never = 0;
  for (const r of rows) {
    if (!r.lastReportAt) never++;
    else if (now - r.lastReportAt.getTime() > STALE_AFTER_MS) stale++;
    else reporting++;
  }
  return { total: rows.length, reporting, stale, never, findings };
}
