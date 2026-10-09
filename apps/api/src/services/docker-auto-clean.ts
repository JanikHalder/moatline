import { eq } from "drizzle-orm";
import { db, servers } from "db";
import { cleanServerDocker } from "./container-redeploy";

const GB = 1024 ** 3;
/** Do not hammer Dokploy: at most one auto-clean per server in this window. */
export const DOCKER_AUTO_CLEAN_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** Only act when Docker can free at least this much. */
export const DOCKER_AUTO_CLEAN_MIN_BYTES = 2 * GB;

/** Unattended deploys are held back when the disk is this full. */
export const DEPLOY_DISK_BLOCK_PCT = 95;
/** A disk reading older than this says nothing about the disk now. */
export const DEPLOY_DISK_REPORT_MAX_AGE_MS = 30 * 60 * 1000;

type DockerDiskPart = {
  sizeBytes?: number | null;
  reclaimableBytes?: number | null;
};

type LastReport = {
  host?: { diskPct?: number | null };
  dockerDisk?: {
    buildCache?: DockerDiskPart | null;
    images?: DockerDiskPart | null;
  } | null;
  dockerAutoCleanAt?: string | null;
};

/** Pure gate — exported for tests. */
export function shouldAutoCleanDocker(opts: {
  diskPct: number | null | undefined;
  diskThreshold: number;
  reclaimableBytes: number;
  lastCleanAt: string | null | undefined;
  now?: number;
  /** Pre-deploy: ignore the 6h cooldown so a full disk is cleared now. */
  skipCooldown?: boolean;
}): boolean {
  const now = opts.now ?? Date.now();
  if (opts.diskPct == null || opts.diskPct < opts.diskThreshold) return false;
  if (opts.reclaimableBytes < DOCKER_AUTO_CLEAN_MIN_BYTES) return false;
  if (
    !opts.skipCooldown &&
    opts.lastCleanAt &&
    now - Date.parse(opts.lastCleanAt) < DOCKER_AUTO_CLEAN_COOLDOWN_MS
  )
    return false;
  return true;
}

/**
 * When the root disk is at/above the server's threshold and Docker reports
 * reclaimable build cache or unused images, clear them through Dokploy.
 * Volumes (customer data) are never touched.
 */
export async function maybeAutoCleanDocker(
  server: typeof servers.$inferSelect,
  report: LastReport = (server.lastReport ?? {}) as LastReport,
  opts: { skipCooldown?: boolean } = {}
): Promise<boolean> {
  const diskPct = report.host?.diskPct;
  const build = report.dockerDisk?.buildCache?.reclaimableBytes ?? 0;
  const images = report.dockerDisk?.images?.reclaimableBytes ?? 0;
  const reclaimable = build + images;
  if (
    !shouldAutoCleanDocker({
      diskPct,
      diskThreshold: server.diskThreshold,
      reclaimableBytes: reclaimable,
      lastCleanAt: report.dockerAutoCleanAt,
      skipCooldown: opts.skipCooldown,
    })
  )
    return false;

  const rows = await db
    .select({
      id: servers.id,
      lastReport: servers.lastReport,
      address: servers.address,
    })
    .from(servers)
    .where(eq(servers.organizationId, server.organizationId));

  const steps: string[] = [];
  // Clear whatever is reclaimable — even small leftovers, once the total
  // crossed the bar and the disk is already over the threshold.
  for (const what of ["builder", "images"] as const) {
    const bytes = what === "builder" ? build : images;
    if (bytes < 100 * 1024 * 1024) continue;
    const r = await cleanServerDocker(
      server.organizationId,
      server.id,
      rows,
      what
    );
    steps.push(r.ok ? what : `${what} failed: ${r.error}`);
  }
  if (steps.length === 0) return false;

  const nextReport = {
    ...(typeof server.lastReport === "object" && server.lastReport
      ? server.lastReport
      : {}),
    ...report,
    dockerAutoCleanAt: new Date().toISOString(),
    dockerAutoCleanDetail: steps.join("; "),
  };
  await db
    .update(servers)
    .set({ lastReport: nextReport })
    .where(eq(servers.id, server.id));

  console.log(
    `[api] docker auto-clean server=${server.id} disk=${Math.round(diskPct ?? 0)}% reclaimable≈${(reclaimable / GB).toFixed(1)}G → ${steps.join(", ")}`
  );
  return steps.some((x) => !x.includes(" failed: "));
}

/**
 * Pure gate — exported for tests. A build needs headroom: on a nearly full
 * disk it fails halfway and can take Docker and the running apps with it.
 * Only a fresh reading counts, and not when we just cleaned (the reading
 * still shows the disk from before).
 */
export function shouldBlockDeployForDisk(opts: {
  diskPct: number | null | undefined;
  reportAt: Date | string | null | undefined;
  cleaned: boolean;
  now?: number;
}): boolean {
  if (opts.cleaned || opts.diskPct == null) return false;
  if (opts.diskPct < DEPLOY_DISK_BLOCK_PCT) return false;
  if (!opts.reportAt) return false;
  const age = (opts.now ?? Date.now()) - new Date(opts.reportAt).getTime();
  return age <= DEPLOY_DISK_REPORT_MAX_AGE_MS;
}

/**
 * Before a deploy: if the app's server is over the disk threshold and Docker
 * can free space, prune build cache + unused images first (no cooldown).
 * Returns the reason when the server is still too full to build on.
 */
export async function maybeCleanBeforeDeploy(
  organizationId: string,
  serverId: string | null | undefined
): Promise<{ blockedReason: string | null }> {
  if (!serverId) return { blockedReason: null };
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, serverId));
  if (!server || server.organizationId !== organizationId)
    return { blockedReason: null };
  const report = (server.lastReport ?? {}) as LastReport;
  const cleaned = await maybeAutoCleanDocker(server, report, {
    skipCooldown: true,
  });
  const diskPct = report.host?.diskPct;
  const blocked = shouldBlockDeployForDisk({
    diskPct,
    reportAt: server.lastReportAt,
    cleaned,
  });
  return {
    blockedReason: blocked
      ? `Server disk is at ${Math.round(diskPct ?? 0)}% and Docker has nothing left to clear — deploy held back so the build cannot fill it. Free space, then deploy again.`
      : null,
  };
}
