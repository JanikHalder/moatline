import { and, desc, eq, inArray } from "drizzle-orm";
import { db, repositories, scans, servers, vulnerabilities } from "db";
import { runSecurityFixWhenIdle } from "./queue-security-fix";

/**
 * Nightly window: pick up every repository that still has a fixable
 * critical/high CVE (non-major) and run security fixes one after another.
 * CVE alerts already queue a fix during the day; this clears the backlog.
 * Merge/deploy still respect org requirePrReview and the non-breaking gate.
 */
export const OVERNIGHT_CRON = "15 2 * * *";

/** Overnight fixes build on the repo's server: skip it when the disk is this full. */
export const OVERNIGHT_DISK_SKIP_PCT = 80;
/** Older disk readings say nothing about tonight; those repos are not skipped. */
export const OVERNIGHT_DISK_REPORT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Pure gate — exported for tests. */
export function shouldSkipOvernightForDisk(opts: {
  diskPct: number | null | undefined;
  reportAt: Date | string | null | undefined;
  now?: number;
}): boolean {
  if (opts.diskPct == null || opts.diskPct < OVERNIGHT_DISK_SKIP_PCT)
    return false;
  if (!opts.reportAt) return false;
  const age = (opts.now ?? Date.now()) - new Date(opts.reportAt).getTime();
  return age <= OVERNIGHT_DISK_REPORT_MAX_AGE_MS;
}

/** Disk reading of the repo's server, or null when the repo has no server. */
async function repoDiskSkipReason(repoId: string): Promise<string | null> {
  const [row] = await db
    .select({
      lastReport: servers.lastReport,
      reportAt: servers.lastReportAt,
    })
    .from(repositories)
    .innerJoin(servers, eq(servers.id, repositories.serverId))
    .where(eq(repositories.id, repoId));
  if (!row) return null;
  const report = (row.lastReport ?? {}) as {
    host?: { diskPct?: number | null };
  };
  const diskPct = report.host?.diskPct;
  if (!shouldSkipOvernightForDisk({ diskPct, reportAt: row.reportAt }))
    return null;
  return `server disk at ${Math.round(diskPct ?? 0)}%`;
}

/** Repos whose latest successful scan still has a non-major fixable CVE. */
export async function findReposNeedingSecurityFix(): Promise<
  Array<{ id: string; name: string; organizationId: string; scanId: string }>
> {
  const repos = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      organizationId: repositories.organizationId,
    })
    .from(repositories);

  if (repos.length === 0) return [];

  const ids = repos.map((r) => r.id);
  const successful = await db
    .select({ id: scans.id, repositoryId: scans.repositoryId })
    .from(scans)
    .where(and(inArray(scans.repositoryId, ids), eq(scans.status, "success")))
    .orderBy(desc(scans.startedAt));
  const scanOf = new Map<string, string>();
  for (const sc of successful) {
    if (!scanOf.has(sc.repositoryId)) scanOf.set(sc.repositoryId, sc.id);
  }
  const scanIds = [...scanOf.values()];
  if (scanIds.length === 0) return [];

  const vulns = await db
    .select({
      scanId: vulnerabilities.scanId,
      severity: vulnerabilities.severity,
      fixAvailable: vulnerabilities.fixAvailable,
      fixIsSemverMajor: vulnerabilities.fixIsSemverMajor,
    })
    .from(vulnerabilities)
    .where(inArray(vulnerabilities.scanId, scanIds));

  const needsFix = new Set<string>();
  for (const v of vulns) {
    if (!v.fixAvailable || v.fixIsSemverMajor) continue;
    if (v.severity !== "critical" && v.severity !== "high") continue;
    needsFix.add(v.scanId);
  }

  return repos
    .filter((r) => {
      const scanId = scanOf.get(r.id);
      return scanId != null && needsFix.has(scanId);
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      organizationId: r.organizationId,
      scanId: scanOf.get(r.id)!,
    }));
}

let overnightRunning = false;

/**
 * Sequential overnight pass. One security fix at a time so the API host
 * is not overloaded; each fix already queues installs/builds on the
 * shared heavy slot.
 */
export async function runOvernightSecurityFixes(): Promise<void> {
  if (overnightRunning) {
    console.log("[api] overnight security fixes already running — skip");
    return;
  }
  overnightRunning = true;
  try {
    const candidates = await findReposNeedingSecurityFix();
    if (candidates.length === 0) {
      console.log("[api] overnight security: nothing to fix");
      return;
    }
    console.log(
      `[api] overnight security: ${candidates.length} repo(s) with fixable critical/high`
    );
    for (const repo of candidates) {
      try {
        const diskReason = await repoDiskSkipReason(repo.id);
        if (diskReason) {
          console.log(
            `[api] overnight security: skipped ${repo.name} (${diskReason})`
          );
          continue;
        }
        const runId = await runSecurityFixWhenIdle(repo.id, {
          scanId: repo.scanId,
          triggerSource: "auto",
          detail: { reason: "overnight" },
        });
        if (runId) {
          console.log(
            `[api] overnight security: finished ${repo.name} run=${runId}`
          );
        } else {
          console.log(
            `[api] overnight security: skipped ${repo.name} (already in flight or open PR)`
          );
        }
      } catch (e) {
        console.error(
          `[api] overnight security: ${repo.name} failed:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  } finally {
    overnightRunning = false;
  }
}
