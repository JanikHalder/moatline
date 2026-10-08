import { and, desc, eq, inArray } from "drizzle-orm";
import { db, repositories, scans, vulnerabilities } from "db";
import { runSecurityFixWhenIdle } from "./queue-security-fix";

/**
 * Nightly window: pick up every repository that still has a fixable
 * critical/high CVE (non-major) and run security fixes one after another.
 * CVE alerts already queue a fix during the day; this clears the backlog.
 * Merge/deploy still respect org requirePrReview and the non-breaking gate.
 */
export const OVERNIGHT_CRON = "15 2 * * *";

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
