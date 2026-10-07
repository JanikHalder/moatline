import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, serverFindings, servers } from "db";
import { notify } from "./notify";

export type FindingSource = (typeof serverFindings.$inferSelect)["source"];
export type FindingSeverity = (typeof serverFindings.$inferSelect)["severity"];

export const SEVERITIES: FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export type FindingInput = {
  fingerprint: string;
  severity: FindingSeverity;
  title: string;
  detail?: string | null;
  target?: string | null;
  reference?: string | null;
  fixAvailable?: boolean | null;
  repositoryId?: string | null;
  /** The server's automation will fix this by then (e.g. tonight's updates). */
  autoFixAt?: Date | null;
};

/** Upper bound per source and report — a misbehaving source must not flood the table. */
export const MAX_FINDINGS_PER_SOURCE = 5000;

const LIMITS = {
  fingerprint: 512,
  title: 300,
  detail: 4000,
  target: 500,
  reference: 1000,
};

function clip(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Only http(s) links survive. Reports come from servers and scanners, i.e.
 * from outside this app — a `javascript:` URL rendered as a link in the UI
 * would be stored XSS.
 */
export function safeReference(value: string | null | undefined): string | null {
  const s = clip(value, LIMITS.reference);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:"
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

export function normalizeSeverity(raw: unknown): FindingSeverity {
  const s = String(raw ?? "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium" || s === "moderate") return "medium";
  if (s === "low") return "low";
  return "info";
}

function normalize(input: FindingInput): FindingInput | null {
  const fingerprint = clip(input.fingerprint, LIMITS.fingerprint);
  const title = clip(input.title, LIMITS.title);
  if (!fingerprint || !title) return null;
  return {
    fingerprint,
    title,
    severity: normalizeSeverity(input.severity),
    detail: clip(input.detail, LIMITS.detail),
    target: clip(input.target, LIMITS.target),
    reference: safeReference(input.reference),
    fixAvailable: input.fixAvailable ?? null,
    repositoryId: input.repositoryId ?? null,
    autoFixAt: input.autoFixAt ?? null,
  };
}

export type SyncResult = {
  opened: FindingInput[];
  resolved: number;
  open: number;
};

/**
 * Replace the open findings of one source on one server with `items`.
 *
 * The source is authoritative for its own findings: whatever it reported is
 * open (new, still there, or back again), whatever it no longer reports is
 * resolved. Sources are independent — a Trivy report never closes a Nuclei
 * finding.
 */
export async function syncFindings(
  serverId: string,
  source: FindingSource,
  items: FindingInput[]
): Promise<SyncResult> {
  const seenAt = new Date();
  // Over the cap, keep the worst: cutting in report order dropped every
  // image after a host with thousands of low CVEs.
  const kept =
    items.length > MAX_FINDINGS_PER_SOURCE
      ? [...items]
          .sort(
            (a, b) =>
              SEVERITIES.indexOf(normalizeSeverity(a.severity)) -
              SEVERITIES.indexOf(normalizeSeverity(b.severity))
          )
          .slice(0, MAX_FINDINGS_PER_SOURCE)
      : items;
  // Deduplicate by fingerprint; the last occurrence wins.
  const byFingerprint = new Map<string, FindingInput>();
  for (const raw of kept) {
    const n = normalize(raw);
    if (n) byFingerprint.set(n.fingerprint, n);
  }
  const list = [...byFingerprint.values()];

  // What was open before, to tell new problems from ones already known.
  const previouslyOpen = new Set(
    (
      await db
        .select({ fingerprint: serverFindings.fingerprint })
        .from(serverFindings)
        .where(
          and(
            eq(serverFindings.serverId, serverId),
            eq(serverFindings.source, source),
            isNull(serverFindings.resolvedAt)
          )
        )
    ).map((r) => r.fingerprint)
  );

  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    await db
      .insert(serverFindings)
      .values(
        chunk.map((f) => ({
          serverId,
          source,
          fingerprint: f.fingerprint,
          severity: f.severity,
          title: f.title,
          detail: f.detail ?? null,
          target: f.target ?? null,
          reference: f.reference ?? null,
          fixAvailable: f.fixAvailable ?? null,
          repositoryId: f.repositoryId ?? null,
          autoFixAt: f.autoFixAt ?? null,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        }))
      )
      .onConflictDoUpdate({
        target: [
          serverFindings.serverId,
          serverFindings.source,
          serverFindings.fingerprint,
        ],
        set: {
          severity: sql`excluded.severity`,
          title: sql`excluded.title`,
          detail: sql`excluded.detail`,
          target: sql`excluded.target`,
          reference: sql`excluded.reference`,
          fixAvailable: sql`excluded.fix_available`,
          repositoryId: sql`excluded.repository_id`,
          autoFixAt: sql`excluded.auto_fix_at`,
          lastSeenAt: sql`excluded.last_seen_at`,
          // A problem that comes back is a new occurrence: restart its clock.
          firstSeenAt: sql`case when ${serverFindings.resolvedAt} is null then ${serverFindings.firstSeenAt} else excluded.first_seen_at end`,
          resolvedAt: sql`null`,
        },
      });
  }

  const resolved = await db
    .update(serverFindings)
    .set({ resolvedAt: seenAt })
    .where(
      and(
        eq(serverFindings.serverId, serverId),
        eq(serverFindings.source, source),
        isNull(serverFindings.resolvedAt),
        lt(serverFindings.lastSeenAt, seenAt)
      )
    )
    .returning({ id: serverFindings.id });

  return {
    opened: list.filter((f) => !previouslyOpen.has(f.fingerprint)),
    resolved: resolved.length,
    open: list.length,
  };
}

const SOURCE_LABEL: Record<FindingSource, string> = {
  host: "Host",
  trivy: "Trivy",
  crowdsec: "CrowdSec",
  nuclei: "Nuclei",
  kuma: "Uptime Kuma",
  wazuh: "Wazuh",
  heartbeat: "Agent",
  network: "External check",
  security: "Security",
  provider: "Hetzner firewall",
  dokploy: "Dokploy",
  registry: "Docker Hub",
  coolify: "Coolify",
  platform: "Platforms",
};

/**
 * Tell the organization about newly opened critical/high findings — one
 * message per sync, not one per finding, so a first Trivy run on an old
 * server does not send three hundred messages.
 */
export async function notifyOpened(
  serverId: string,
  source: FindingSource,
  result: SyncResult
): Promise<void> {
  // Something the server's automation fixes on its own is not worth a
  // message — the alert comes if it does *not* get fixed (updates:stuck).
  const urgent = result.opened.filter(
    (f) => (f.severity === "critical" || f.severity === "high") && !f.autoFixAt
  );
  if (urgent.length === 0) return;
  const [server] = await db
    .select({ name: servers.name, organizationId: servers.organizationId })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);
  if (!server) return;
  const lines = urgent
    .slice(0, 10)
    .map(
      (f) =>
        `• [${f.severity.toUpperCase()}] ${f.title}${f.target ? ` — ${f.target}` : ""}`
    );
  if (urgent.length > 10) lines.push(`… and ${urgent.length - 10} more`);
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  await notify(server.organizationId, {
    type: "server_alert",
    title: `${server.name}: ${urgent.length} new ${urgent.length === 1 ? "problem" : "problems"} (${SOURCE_LABEL[source]})`,
    message: lines.join("\n"),
    url: appUrl ? `${appUrl}/servers/${serverId}` : undefined,
    scope: { serverId },
  });
}

/** syncFindings + notifyOpened, for callers that do not need the details. */
export async function syncAndNotify(
  serverId: string,
  source: FindingSource,
  items: FindingInput[]
): Promise<SyncResult> {
  const result = await syncFindings(serverId, source, items);
  await notifyOpened(serverId, source, result).catch((e) =>
    console.error("[servers] notify failed:", e)
  );
  return result;
}

/** Open finding counts per server and severity, for list views. */
export async function openCountsByServer(
  serverIds: string[]
): Promise<Map<string, Record<FindingSeverity | "total", number>>> {
  const out = new Map<string, Record<FindingSeverity | "total", number>>();
  if (serverIds.length === 0) return out;
  const rows = await db
    .select({
      serverId: serverFindings.serverId,
      severity: serverFindings.severity,
      n: sql<number>`count(*)::int`,
    })
    .from(serverFindings)
    .where(
      and(
        inArray(serverFindings.serverId, serverIds),
        isNull(serverFindings.resolvedAt)
      )
    )
    .groupBy(serverFindings.serverId, serverFindings.severity);
  for (const r of rows) {
    const c = out.get(r.serverId) ?? emptyFindingCounts();
    c[r.severity] += r.n;
    c.total += r.n;
    out.set(r.serverId, c);
  }
  return out;
}

export function emptyFindingCounts(): Record<
  FindingSeverity | "total",
  number
> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
}
