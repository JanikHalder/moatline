import { and, desc, eq, gte } from "drizzle-orm";
import { db, storageMetrics } from "db";
import type { FindingInput } from "../lib/server-findings";
import type { AgentReport } from "./agent-report";

/**
 * Object storage (MinIO & co.) and disks over time: how big a store is, how
 * fast it grows, and when it hits its limit or fills the disk. The agent
 * measures hourly; one row per disk and store per hour is the history.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GB = 1e9;
/** How far back growth is measured: a week evens out weekly backups. */
const WINDOW_MS = 7 * DAY;
/** Less history than this says nothing about a trend. */
const MIN_SPAN_MS = 2 * DAY;
const MIN_SAMPLES = 12;
/** Warn this many days ahead. */
export const FORECAST_DAYS = 14;

export type StorageCheck = {
  name: string;
  path: string | null;
  limitGb: number | null;
};
export type StorageItem = NonNullable<AgentReport["storage"]>["items"][number];
export type Forecast = Record<
  string,
  { perDay: number; daysLeft: number | null }
>;

const gb = (n: number) =>
  n >= 10 * GB ? `${Math.round(n / GB)} GB` : `${(n / GB).toFixed(1)} GB`;

export const diskKey = (mount: string) => `disk:${mount}`;
export const storageKey = (name: string) => `storage:${name}`;

/**
 * Growth in bytes per day: the slope of a straight line through the
 * samples (least squares), so one big upload does not read as a trend.
 * Null without enough history.
 */
export function growthPerDay(
  samples: Array<{ t: number; used: number }>
): number | null {
  if (samples.length < MIN_SAMPLES) return null;
  const t0 = samples[0]!.t;
  const span = samples[samples.length - 1]!.t - t0;
  if (span < MIN_SPAN_MS) return null;
  const n = samples.length;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const s of samples) {
    const x = (s.t - t0) / DAY;
    sx += x;
    sy += s.used;
    sxx += x * x;
    sxy += x * s.used;
  }
  const denom = n * sxx - sx * sx;
  return denom === 0 ? null : (n * sxy - sx * sy) / denom;
}

/** Days until `used` reaches `cap` at `perDay`; null when it does not grow. */
export function daysUntil(
  used: number,
  cap: number,
  perDay: number | null
): number | null {
  if (perDay == null || perDay <= 0) return null;
  return Math.max(0, (cap - used) / perDay);
}

/** One row per disk and store, at most once an hour. */
export async function recordStorageMetrics(
  serverId: string,
  report: AgentReport,
  now: Date
): Promise<void> {
  const [last] = await db
    .select({ at: storageMetrics.recordedAt })
    .from(storageMetrics)
    .where(eq(storageMetrics.serverId, serverId))
    .orderBy(desc(storageMetrics.recordedAt))
    .limit(1);
  if (last && now.getTime() - last.at.getTime() < 55 * 60 * 1000) return;
  const rows = [
    ...report.host.disks
      .filter((d) => d.totalBytes > 0)
      .map((d) => ({
        key: diskKey(d.mount),
        usedBytes: Math.round(d.usedBytes),
        totalBytes: Math.round(d.totalBytes),
      })),
    ...(report.storage?.items ?? [])
      .filter((i) => i.sizeBytes != null)
      .map((i) => ({
        key: storageKey(i.name),
        usedBytes: Math.round(i.sizeBytes!),
        totalBytes: i.disk ? Math.round(i.disk.totalBytes) : null,
      })),
  ];
  if (!rows.length) return;
  await db
    .insert(storageMetrics)
    .values(rows.map((r) => ({ ...r, serverId, recordedAt: now })));
}

/** Growth per disk and store over the last week. */
export async function loadGrowth(
  serverId: string,
  now: Date
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      key: storageMetrics.key,
      at: storageMetrics.recordedAt,
      used: storageMetrics.usedBytes,
    })
    .from(storageMetrics)
    .where(
      and(
        eq(storageMetrics.serverId, serverId),
        gte(storageMetrics.recordedAt, new Date(now.getTime() - WINDOW_MS))
      )
    )
    .orderBy(storageMetrics.recordedAt);
  const byKey = new Map<string, Array<{ t: number; used: number }>>();
  for (const r of rows) {
    const list = byKey.get(r.key) ?? [];
    list.push({ t: r.at.getTime(), used: r.used });
    byKey.set(r.key, list);
  }
  const out = new Map<string, number>();
  for (const [key, samples] of byKey) {
    const g = growthPerDay(samples);
    if (g != null) out.set(key, g);
  }
  return out;
}

/** What is shown next to each disk and store: growth and days left. */
export function buildForecast(
  report: AgentReport,
  checks: StorageCheck[],
  growth: Map<string, number>
): Forecast {
  const out: Forecast = {};
  for (const d of report.host.disks) {
    const perDay = growth.get(diskKey(d.mount));
    if (perDay == null) continue;
    out[diskKey(d.mount)] = {
      perDay,
      daysLeft: daysUntil(d.usedBytes, d.totalBytes, perDay),
    };
  }
  const limits = new Map(checks.map((c) => [c.name, c.limitGb]));
  for (const i of report.storage?.items ?? []) {
    const perDay = growth.get(storageKey(i.name));
    if (perDay == null || i.sizeBytes == null) continue;
    const limit = limits.get(i.name);
    out[storageKey(i.name)] = {
      perDay,
      daysLeft: limit ? daysUntil(i.sizeBytes, limit * GB, perDay) : null,
    };
  }
  return out;
}

const LABEL: Record<string, string> = {
  minio: "MinIO",
  garage: "Garage",
  seaweedfs: "SeaweedFS",
  rustfs: "RustFS",
  cloudserver: "Zenko CloudServer",
  versitygw: "Versity Gateway",
  ceph: "Ceph",
};

export function storageLabel(i: Pick<StorageItem, "name" | "kind">): string {
  return i.kind === "folder"
    ? `Folder "${i.name}"`
    : `${LABEL[i.kind] ?? "S3"} storage "${i.name}"`;
}

function biggest(i: StorageItem): string {
  const top = i.folders.slice(0, 3);
  if (!top.length) return "";
  const what = i.kind === "folder" ? "Biggest folders" : "Biggest buckets";
  return ` ${what}: ${top.map((f) => `${f.name} ${gb(f.sizeBytes)}`).join(", ")}.`;
}

/** What to do about a store that grows too much — never done for you. */
export function shrinkHint(i: Pick<StorageItem, "kind">): string {
  if (i.kind === "minio" || i.kind === "rustfs")
    return "Let old objects expire with a lifecycle rule (`mc ilm rule add --expire-days 30 <alias>/<bucket>`; with versioning on, `--noncurrent-expire-days 7` removes old versions), delete what is no longer needed, or give the volume more space.";
  if (i.kind === "folder")
    return "Delete or move old files, or give the disk more space.";
  return "Delete what is no longer needed, let the tool that writes the backups keep fewer of them, or give the volume more space.";
}

/** The biggest store on a disk, for the "disk is full" finding. */
export function storageOnDisk(
  report: AgentReport,
  mount: string
): string | null {
  const items = (report.storage?.items ?? [])
    .filter((i) => i.disk?.mount === mount && (i.sizeBytes ?? 0) >= GB)
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const i = items[0];
  if (!i) return null;
  return `${storageLabel(i)} takes ${gb(i.sizeBytes!)} of it.${biggest(i)} ${shrinkHint(i)}`;
}

function about(days: number): string {
  if (days < 1) return "within a day";
  const d = Math.round(days);
  return `in about ${d} ${d === 1 ? "day" : "days"}`;
}

/**
 * Stores over (or soon over) their limit, disks that will be full within
 * two weeks at the current growth, and folders that cannot be measured.
 */
export function storageFindings(
  report: AgentReport,
  checks: StorageCheck[],
  growth: Map<string, number>,
  diskThreshold: number
): FindingInput[] {
  const out: FindingInput[] = [];
  for (const d of report.host.disks) {
    if (d.totalBytes <= 0) continue;
    const pctUsed = (d.usedBytes / d.totalBytes) * 100;
    // Already over the threshold: the "disk is full" finding says it.
    if (pctUsed >= diskThreshold) continue;
    const perDay = growth.get(diskKey(d.mount)) ?? null;
    const days = daysUntil(d.usedBytes, d.totalBytes, perDay);
    if (days == null || days > FORECAST_DAYS) continue;
    const onIt = storageOnDisk(report, d.mount);
    out.push({
      fingerprint: `disk-forecast:${d.mount}`,
      severity: days <= 3 ? "high" : "medium",
      title: `Disk ${d.mount} will be full ${about(days)}`,
      detail: `It grows by about ${gb(perDay!)} a day (over the last week) and has ${gb(d.totalBytes - d.usedBytes)} left, ${Math.round(pctUsed)}% used.${onIt ? ` ${onIt}` : ""}`,
      target: d.mount,
    });
  }

  const items = new Map((report.storage?.items ?? []).map((i) => [i.name, i]));
  for (const i of items.values()) {
    if (!i.error) continue;
    const missing = i.sizeBytes == null;
    out.push({
      fingerprint: `storage:error:${i.name}`,
      severity: i.kind === "folder" && missing ? "medium" : "low",
      title: `${storageLabel(i)} could not be measured`,
      detail: `${i.error}${i.paths.length ? ` (${i.paths.join(", ")})` : ""}.`,
      target: i.paths[0] ?? i.name,
    });
  }
  for (const check of checks) {
    const i = items.get(check.name);
    if (!check.limitGb || !i || i.sizeBytes == null) continue;
    const limit = check.limitGb * GB;
    const used = i.sizeBytes;
    const share = used / limit;
    if (share >= 0.9) {
      out.push({
        fingerprint: `storage:limit:${i.name}`,
        severity: share >= 1 ? "high" : "medium",
        title:
          share >= 1
            ? `${storageLabel(i)} is over its limit: ${gb(used)} of ${gb(limit)}`
            : `${storageLabel(i)} is almost at its limit: ${gb(used)} of ${gb(limit)}`,
        detail: `${biggest(i).trim()} ${shrinkHint(i)}`.trim(),
        target: i.paths[0] ?? i.name,
      });
      continue;
    }
    const perDay = growth.get(storageKey(i.name)) ?? null;
    const days = daysUntil(used, limit, perDay);
    if (days == null || days > FORECAST_DAYS) continue;
    out.push({
      fingerprint: `storage:forecast:${i.name}`,
      severity: "medium",
      title: `${storageLabel(i)} reaches its ${gb(limit)} limit ${about(days)}`,
      detail: `It holds ${gb(used)} and grows by about ${gb(perDay!)} a day (over the last week).${biggest(i)} ${shrinkHint(i)}`,
      target: i.paths[0] ?? i.name,
    });
  }
  return out;
}
