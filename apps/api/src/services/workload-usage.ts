import { and, eq, gte, lt, sql } from "drizzle-orm";
import { containerMetrics, db, servers } from "db";
import type { FindingInput } from "../lib/server-findings";
import { repoForApp } from "./dokploy-sync";

const HOUR = 60 * 60 * 1000;
const MIB = 1024 * 1024;

export type ContainerUsage = {
  name: string;
  image?: string | null;
  app?: string | null;
  memBytes?: number | null;
  memLimit?: number | null;
  cpuPct?: number | null;
  oomKilled?: boolean | null;
  restartCount?: number | null;
};

export type AppUsage = {
  app: string;
  containers: string[];
  image: string | null;
  memBytes: number;
  /** Sum of the replicas' limits; null when any replica has none. */
  memLimit: number | null;
  cpuPct: number | null;
  oomKilled: boolean;
};

export type WorkloadBaseline = {
  computedAt: string;
  apps: Record<
    string,
    {
      mem: number;
      /** 95th percentile of memory over the window; sizes a limit. */
      memP95?: number;
      cpu: number | null;
      samples: number;
      since: string;
    }
  >;
};

/**
 * Memory limit to suggest for an app that has none: the 95th percentile of
 * its last week plus 50% headroom, rounded up to 256 MB.
 */
export function suggestedLimit(memP95: number): number {
  const step = 256 * MIB;
  return Math.max(step, Math.ceil((memP95 * 1.5) / step) * step);
}

/** Replicas of one app add up: the app is what leaks, not one task. */
export function aggregateApps(containers: ContainerUsage[]): AppUsage[] {
  const apps = new Map<string, AppUsage>();
  for (const c of containers) {
    if (c.memBytes == null) continue;
    const key = c.app || c.name;
    const a = apps.get(key) ?? {
      app: key,
      containers: [],
      image: c.image ?? null,
      memBytes: 0,
      memLimit: 0,
      cpuPct: null,
      oomKilled: false,
    };
    a.containers.push(c.name);
    a.memBytes += c.memBytes;
    a.memLimit =
      a.memLimit == null || !c.memLimit ? null : a.memLimit + c.memLimit;
    if (c.cpuPct != null) a.cpuPct = (a.cpuPct ?? 0) + c.cpuPct;
    a.oomKilled ||= !!c.oomKilled;
    apps.set(key, a);
  }
  return [...apps.values()];
}

export function formatMem(bytes: number): string {
  return bytes >= 1024 * MIB
    ? `${(bytes / (1024 * MIB)).toFixed(1)} GB`
    : `${Math.round(bytes / MIB)} MB`;
}

/** Remediations appended to container memory findings (Next.js / Node). */
export const NODE_HINT =
  "For a Next.js/Node app: set a memory limit in Dokploy or Coolify (Resources) and NODE_OPTIONS=--max-old-space-size at about 75% of that limit, so a leak restarts the app instead of starving the server. Typical causes: unbounded fetch/ISR cache, large in-memory Maps, Payload media kept in RAM, too many concurrent image optimizations, or a module that loads once and never frees. Diagnose: node --inspect (or NODE_OPTIONS=--inspect=0.0.0.0:9229), Chrome DevTools → Memory → heap snapshot before vs after traffic; or redeploy and watch whether RSS climbs again between deploys.";

/** Enough history to call something unusual: one day of reports. */
const MIN_SAMPLES = 288;

/**
 * Apps using unusually much memory or CPU: near their limit, killed for
 * running out of memory, far above their own usual level, or taking a big
 * share of the server without a limit.
 */
export function usageFindings(
  containers: ContainerUsage[],
  ctx: {
    baseline?: WorkloadBaseline | null;
    hostMemBytes?: number | null;
    previous?: ContainerUsage[] | null;
    /** Dokploy service name → repository. */
    repoByApp?: Map<string, string>;
  } = {}
): FindingInput[] {
  const out: FindingInput[] = [];
  const prevCpu = new Map(
    aggregateApps(ctx.previous ?? []).map((a) => [a.app, a.cpuPct])
  );
  for (const a of aggregateApps(containers)) {
    const repositoryId = ctx.repoByApp
      ? repoForApp(a.app, ctx.repoByApp)
      : null;
    const base = ctx.baseline?.apps[a.app];
    const known = base && base.samples >= MIN_SAMPLES ? base : null;
    const who =
      a.containers.length > 1
        ? `${a.containers.length} containers: ${a.containers.slice(0, 5).join(", ")}`
        : a.containers[0]!;
    const usual = known ? ` (usually ${formatMem(known.mem)})` : "";

    if (a.oomKilled) {
      out.push({
        fingerprint: `usage:oom:${a.app}`,
        severity: "high",
        title: `${a.app} was killed for running out of memory`,
        detail: `${who}. The kernel ended it at its memory limit and Docker restarted it — requests in flight were lost. Raise the limit if the app needs it, or find the leak.\n${NODE_HINT}`,
        target: a.image,
        repositoryId,
      });
    }
    if (a.memLimit && a.memBytes / a.memLimit >= 0.9) {
      out.push({
        fingerprint: `usage:limit:${a.app}`,
        severity: "high",
        title: `${a.app} uses ${Math.round((a.memBytes / a.memLimit) * 100)}% of its memory limit`,
        detail: `${formatMem(a.memBytes)} of ${formatMem(a.memLimit)}${usual}. At the limit the kernel kills it. ${who}.\n${NODE_HINT}`,
        target: a.image,
        repositoryId,
      });
    } else if (
      known &&
      a.memBytes >= 2 * known.mem &&
      a.memBytes - known.mem >= 256 * MIB
    ) {
      const factor = a.memBytes / known.mem;
      out.push({
        fingerprint: `usage:memory:${a.app}`,
        severity: factor >= 3 ? "high" : "medium",
        title: `${a.app} uses ${factor.toFixed(1)}× its usual memory`,
        detail: `${formatMem(a.memBytes)} now, ${formatMem(known.mem)} is its 7-day median. Growing without a deploy usually means a leak (caches without a size limit, listeners never removed). ${who}.\n${NODE_HINT}`,
        target: a.image,
        repositoryId,
      });
    } else if (
      !a.memLimit &&
      ctx.hostMemBytes &&
      a.memBytes / ctx.hostMemBytes >= 0.4
    ) {
      const share = a.memBytes / ctx.hostMemBytes;
      out.push({
        fingerprint: `usage:share:${a.app}`,
        severity: share >= 0.6 ? "high" : "medium",
        title: `${a.app} takes ${Math.round(share * 100)}% of the server's memory, without a limit`,
        detail: `${formatMem(a.memBytes)}${usual}. Without a limit one leaking app takes every other app on the server down with it.${known?.memP95 ? ` Suggested limit: ${formatMem(suggestedLimit(known.memP95))} (95th percentile of the last 7 days plus headroom).` : ""} ${who}.\n${NODE_HINT}`,
        target: a.image,
        repositoryId,
      });
    }

    // A Node app is single-threaded: 100% of one core for ten minutes is a
    // stuck event loop or a hot loop, not load.
    const prev = prevCpu.get(a.app);
    if (
      a.cpuPct != null &&
      prev != null &&
      a.cpuPct >= 90 &&
      prev >= 90 &&
      (!known || known.cpu == null || known.cpu < 50)
    ) {
      out.push({
        fingerprint: `usage:cpu:${a.app}`,
        severity: "medium",
        title: `${a.app} keeps ${a.cpuPct >= 150 ? `${(a.cpuPct / 100).toFixed(1)} CPU cores` : "a CPU core"} busy`,
        detail: `Two reports in a row (10+ minutes)${known?.cpu != null ? `, usually ${Math.round(known.cpu)}%` : ""}. For a Node/Next.js app that means requests wait: look for a loop, heavy rendering without cache, or a crawler hammering it (logs). ${who}.`,
        target: a.image,
        repositoryId,
      });
    }
  }
  return out;
}

export async function recordContainerMetrics(
  serverId: string,
  containers: ContainerUsage[],
  now: Date
): Promise<void> {
  const rows = aggregateApps(containers).map((a) => ({
    serverId,
    app: a.app,
    recordedAt: now,
    memBytes: Math.round(a.memBytes),
    cpuPct: a.cpuPct == null ? null : Math.round(a.cpuPct * 10) / 10,
  }));
  if (rows.length) await db.insert(containerMetrics).values(rows);
}

/**
 * 7-day median per app, leaving out the last hour so a spike in progress
 * does not raise its own bar. Recomputed at most hourly.
 */
export async function currentBaseline(
  serverId: string,
  stored: WorkloadBaseline | null,
  now: Date
): Promise<WorkloadBaseline | null> {
  if (stored && now.getTime() - new Date(stored.computedAt).getTime() < HOUR)
    return stored;
  const rows = await db
    .select({
      app: containerMetrics.app,
      mem: sql<number>`percentile_cont(0.5) within group (order by ${containerMetrics.memBytes})`,
      memP95: sql<number>`percentile_cont(0.95) within group (order by ${containerMetrics.memBytes})`,
      cpu: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${containerMetrics.cpuPct})`,
      samples: sql<number>`count(*)::int`,
      since: sql<string>`min(${containerMetrics.recordedAt})`,
    })
    .from(containerMetrics)
    .where(
      and(
        eq(containerMetrics.serverId, serverId),
        gte(
          containerMetrics.recordedAt,
          new Date(now.getTime() - 7 * 24 * HOUR)
        ),
        lt(containerMetrics.recordedAt, new Date(now.getTime() - HOUR))
      )
    )
    .groupBy(containerMetrics.app);
  const baseline: WorkloadBaseline = {
    computedAt: now.toISOString(),
    apps: Object.fromEntries(
      rows.map((r) => [
        r.app,
        {
          mem: Number(r.mem),
          memP95: Number(r.memP95),
          cpu: r.cpu == null ? null : Number(r.cpu),
          samples: Number(r.samples),
          since: new Date(r.since).toISOString(),
        },
      ])
    ),
  };
  await db
    .update(servers)
    .set({ workloadBaseline: baseline })
    .where(eq(servers.id, serverId));
  return baseline;
}

export const CONTAINER_METRICS_RETENTION_MS = 8 * 24 * HOUR;
