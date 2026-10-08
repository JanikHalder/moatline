import { eq } from "drizzle-orm";
import { db, servers } from "db";
import { cleanServerDocker } from "./container-redeploy";

const GB = 1024 ** 3;
/** Do not hammer Dokploy: at most one auto-clean per server in this window. */
export const DOCKER_AUTO_CLEAN_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** Only act when Docker can free at least this much. */
export const DOCKER_AUTO_CLEAN_MIN_BYTES = 2 * GB;

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
}): boolean {
  const now = opts.now ?? Date.now();
  if (opts.diskPct == null || opts.diskPct < opts.diskThreshold) return false;
  if (opts.reclaimableBytes < DOCKER_AUTO_CLEAN_MIN_BYTES) return false;
  if (
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
  report: LastReport = (server.lastReport ?? {}) as LastReport
): Promise<void> {
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
    })
  )
    return;

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
  if (steps.length === 0) return;

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
}
