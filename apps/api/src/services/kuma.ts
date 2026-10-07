import { and, eq, isNotNull } from "drizzle-orm";
import { db, orgIntegrations, repositories, servers } from "db";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { validateLiveUrl } from "../lib/live-check";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";
import { notify } from "../lib/notify";

export type KumaMonitor = {
  name: string;
  type: string | null;
  url: string | null;
  hostname: string | null;
  /** 0 = down, 1 = up, 2 = pending, 3 = maintenance (Uptime Kuma's values). */
  status: number | null;
  responseTimeMs: number | null;
  certDaysRemaining: number | null;
  certValid: boolean | null;
};

const STATUS_LABEL: Record<number, string> = {
  0: "down",
  1: "up",
  2: "pending",
  3: "maintenance",
};

/** Parse one Prometheus label set: `a="x",b="y \"q\""`. */
function parseLabels(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out[m[1]!] = m[2]!.replace(/\\(.)/g, (_, c: string) =>
      c === "n" ? "\n" : c
    );
  }
  return out;
}

/**
 * Uptime Kuma's /metrics output, one entry per monitor. Only the metrics we
 * act on are read; everything else in the exposition is ignored.
 */
export function parseKumaMetrics(text: string): KumaMonitor[] {
  const byName = new Map<string, KumaMonitor>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(monitor_\w+)\{(.*)\}\s+(\S+)/);
    if (!m) continue;
    const [, metric, rawLabels, rawValue] = m;
    const labels = parseLabels(rawLabels!);
    const name = labels.monitor_name;
    if (!name) continue;
    const value = Number(rawValue);
    const nullable = (v: string | undefined) =>
      v && v !== "null" && v !== "undefined" ? v : null;
    const mon = byName.get(name) ?? {
      name,
      type: nullable(labels.monitor_type),
      url: nullable(labels.monitor_url),
      hostname: nullable(labels.monitor_hostname),
      status: null,
      responseTimeMs: null,
      certDaysRemaining: null,
      certValid: null,
    };
    if (!Number.isFinite(value)) {
      byName.set(name, mon);
      continue;
    }
    if (metric === "monitor_status") mon.status = value;
    else if (metric === "monitor_response_time") mon.responseTimeMs = value;
    else if (metric === "monitor_cert_days_remaining")
      mon.certDaysRemaining = value;
    else if (metric === "monitor_cert_is_valid") mon.certValid = value === 1;
    byName.set(name, mon);
  }
  return [...byName.values()];
}

function monitorHost(m: KumaMonitor): string | null {
  if (m.url) {
    try {
      return new URL(m.url).hostname;
    } catch {
      // fall through to hostname
    }
  }
  return m.hostname;
}

export function kumaFindings(
  monitors: KumaMonitor[],
  repoByHost: Map<string, string>
): FindingInput[] {
  const out: FindingInput[] = [];
  for (const m of monitors) {
    const host = monitorHost(m);
    const repositoryId = host ? (repoByHost.get(host) ?? null) : null;
    const target = m.url ?? m.hostname ?? null;
    if (m.status === 0) {
      out.push({
        fingerprint: `down:${m.name}`,
        severity: "critical",
        title: `Monitor "${m.name}" is down`,
        detail: "Uptime Kuma reports this monitor as down.",
        target,
        repositoryId,
      });
    } else if (m.status === 2) {
      out.push({
        fingerprint: `pending:${m.name}`,
        severity: "medium",
        title: `Monitor "${m.name}" is failing (retrying)`,
        detail:
          "Uptime Kuma is retrying after a failed check; it turns into “down” if the retries fail too.",
        target,
        repositoryId,
      });
    }
    if (m.certValid === false) {
      out.push({
        fingerprint: `cert-invalid:${m.name}`,
        severity: "high",
        title: `Invalid TLS certificate on "${m.name}"`,
        target,
        repositoryId,
      });
    } else if (m.certDaysRemaining != null && m.certDaysRemaining <= 21) {
      out.push({
        fingerprint: `cert-expiry:${m.name}`,
        severity: m.certDaysRemaining <= 7 ? "high" : "medium",
        title: `TLS certificate of "${m.name}" expires in ${Math.max(0, Math.floor(m.certDaysRemaining))} days`,
        detail:
          "Automatic renewal should have happened by now — check the reverse proxy / ACME client.",
        target,
        repositoryId,
      });
    }
  }
  return out;
}

export async function fetchKumaMonitors(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 15_000
): Promise<KumaMonitor[]> {
  const valid = validateLiveUrl(baseUrl);
  if (!valid.ok) throw new Error(valid.reason);
  const url = `${baseUrl.replace(/\/+$/, "")}/metrics`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      // Uptime Kuma API keys go in as the basic-auth password, user empty.
      headers: {
        authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`,
        accept: "text/plain",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Uptime Kuma rejected the API key.");
    }
    if (!res.ok) throw new Error(`Uptime Kuma answered HTTP ${res.status}.`);
    const text = await res.text();
    return parseKumaMetrics(text.slice(0, 10 * 1024 * 1024));
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `Uptime Kuma did not answer within ${timeoutMs / 1000}s.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveKumaConfig(
  orgId: string
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const [integ] = await db
    .select({
      kumaBaseUrl: orgIntegrations.kumaBaseUrl,
      kumaApiKey: orgIntegrations.kumaApiKey,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId))
    .limit(1);
  if (!integ?.kumaBaseUrl || !integ.kumaApiKey) return null;
  try {
    const apiKey = isEncrypted(integ.kumaApiKey)
      ? decryptSecret(integ.kumaApiKey)
      : integ.kumaApiKey;
    return { baseUrl: integ.kumaBaseUrl, apiKey };
  } catch {
    return null;
  }
}

/**
 * Pull Uptime Kuma once for an organization and attach each monitor to the
 * server it belongs to: either named on the server, or pointing at the live
 * URL of an application linked to that server.
 */
export type MonitorAssignment = {
  serverId: string | null;
  serverName: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  /** "manual" = picked on the server, "url" = matched by an app's live URL. */
  via: "manual" | "url" | null;
};

type OrgContext = {
  servers: Array<typeof servers.$inferSelect>;
  repos: Array<{
    id: string;
    name: string;
    serverId: string | null;
    liveUrl: string | null;
  }>;
};

async function loadOrgContext(orgId: string): Promise<OrgContext> {
  const orgServers = await db
    .select()
    .from(servers)
    .where(eq(servers.organizationId, orgId));
  const repos = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      serverId: repositories.serverId,
      liveUrl: repositories.liveUrl,
    })
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, orgId),
        isNotNull(repositories.liveUrl)
      )
    );
  return { servers: orgServers, repos };
}

function hostOfUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Which server and application a monitor belongs to. A monitor picked on a
 * server wins; otherwise its host is matched against the applications' live
 * URLs (which also tells the server, when the application has one).
 */
export function assignMonitor(
  m: KumaMonitor,
  ctx: OrgContext
): MonitorAssignment {
  const host = monitorHost(m);
  const repo = host
    ? (ctx.repos.find((r) => hostOfUrl(r.liveUrl) === host) ?? null)
    : null;
  const manual = ctx.servers.find((s) =>
    (s.kumaMonitors ?? []).includes(m.name)
  );
  const server =
    manual ??
    (repo?.serverId
      ? (ctx.servers.find((s) => s.id === repo.serverId) ?? null)
      : null);
  return {
    serverId: server?.id ?? null,
    serverName: server?.name ?? null,
    repositoryId: repo?.id ?? null,
    repositoryName: repo?.name ?? null,
    via: manual ? "manual" : server ? "url" : null,
  };
}

export type OrgKumaState = {
  checkedAt: string | null;
  error: string | null;
  errorAt?: string;
  monitors: Array<KumaMonitor & { statusLabel: string | null }>;
};

function withLabel(m: KumaMonitor) {
  return {
    ...m,
    statusLabel: m.status == null ? null : (STATUS_LABEL[m.status] ?? null),
  };
}

/**
 * Pull Uptime Kuma once for an organization: keep every monitor at org level
 * (for the uptime overview), then attach each one to the server it belongs
 * to — either picked on the server, or pointing at the live URL of an
 * application linked to that server.
 */
export async function syncKumaForOrg(orgId: string): Promise<void> {
  const config = await resolveKumaConfig(orgId);
  if (!config) return;
  const ctx = await loadOrgContext(orgId);
  const [integ] = await db
    .select({ kumaState: orgIntegrations.kumaState })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId));
  const previous = (integ?.kumaState ?? null) as OrgKumaState | null;

  let monitors: KumaMonitor[];
  try {
    monitors = await fetchKumaMonitors(config.baseUrl, config.apiKey);
  } catch (e) {
    // Unreachable Kuma says nothing about the monitors: keep their findings
    // open and record why the data is stale.
    const error = e instanceof Error ? e.message : String(e);
    const errorAt = new Date().toISOString();
    await db
      .update(orgIntegrations)
      .set({
        kumaState: {
          checkedAt: previous?.checkedAt ?? null,
          monitors: previous?.monitors ?? [],
          error,
          errorAt,
        },
      })
      .where(eq(orgIntegrations.organizationId, orgId));
    for (const s of ctx.servers) {
      const prev = (s.kumaState ?? {}) as Record<string, unknown>;
      await db
        .update(servers)
        .set({ kumaState: { ...prev, error, errorAt } })
        .where(eq(servers.id, s.id));
    }
    return;
  }

  const checkedAt = new Date().toISOString();
  await db
    .update(orgIntegrations)
    .set({
      kumaState: { checkedAt, error: null, monitors: monitors.map(withLabel) },
    })
    .where(eq(orgIntegrations.organizationId, orgId));

  // Monitors attached to a server notify through that server's findings.
  // The rest would go down unnoticed, so they notify on the transition here.
  const wasDown = new Set(
    (previous?.monitors ?? []).filter((m) => m.status === 0).map((m) => m.name)
  );
  const newlyDown = monitors.filter(
    (m) =>
      m.status === 0 &&
      !wasDown.has(m.name) &&
      !assignMonitor(m, ctx).serverId &&
      previous !== null
  );
  if (newlyDown.length > 0) {
    const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
    await notify(orgId, {
      type: "server_alert",
      title: `Uptime Kuma: ${newlyDown.length} ${newlyDown.length === 1 ? "monitor" : "monitors"} down`,
      message: newlyDown
        .map((m) => `• ${m.name}${m.url ? ` — ${m.url}` : ""}`)
        .join("\n"),
      url: appUrl ? `${appUrl}/monitoring` : undefined,
    }).catch(() => {});
  }

  for (const s of ctx.servers) {
    const repoByHost = new Map<string, string>();
    for (const r of ctx.repos) {
      const host = hostOfUrl(r.liveUrl);
      if (r.serverId === s.id && host) repoByHost.set(host, r.id);
    }
    const mine = monitors.filter(
      (m) => assignMonitor(m, ctx).serverId === s.id
    );
    await db
      .update(servers)
      .set({
        kumaState: { checkedAt, error: null, monitors: mine.map(withLabel) },
      })
      .where(eq(servers.id, s.id));
    await syncAndNotify(s.id, "kuma", kumaFindings(mine, repoByHost));
  }
}

/** The org-wide monitor list with each monitor's server and application. */
export async function uptimeOverview(orgId: string) {
  const [integ] = await db
    .select({
      kumaBaseUrl: orgIntegrations.kumaBaseUrl,
      kumaApiKey: orgIntegrations.kumaApiKey,
      kumaState: orgIntegrations.kumaState,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId));
  const configured = !!integ?.kumaBaseUrl && !!integ.kumaApiKey;
  const state = (integ?.kumaState ?? null) as OrgKumaState | null;
  const ctx = await loadOrgContext(orgId);
  return {
    configured,
    baseUrl: integ?.kumaBaseUrl ?? null,
    checkedAt: state?.checkedAt ?? null,
    error: state?.error ?? null,
    monitors: (state?.monitors ?? []).map((m) => ({
      ...m,
      ...assignMonitor(m, ctx),
    })),
    servers: ctx.servers.map((s) => ({ id: s.id, name: s.name })),
  };
}

/**
 * Attach a monitor to one server (or none). A monitor belongs to at most one
 * server, so it is removed from every other server's list first.
 */
export async function assignMonitorToServer(
  orgId: string,
  monitor: string,
  serverId: string | null
): Promise<boolean> {
  const ctx = await loadOrgContext(orgId);
  if (serverId && !ctx.servers.some((s) => s.id === serverId)) return false;
  for (const s of ctx.servers) {
    const list = s.kumaMonitors ?? [];
    const next = list.filter((n) => n !== monitor);
    if (s.id === serverId) next.push(monitor);
    if (next.length !== list.length || s.id === serverId) {
      await db
        .update(servers)
        .set({ kumaMonitors: [...new Set(next)] })
        .where(eq(servers.id, s.id));
    }
  }
  return true;
}
