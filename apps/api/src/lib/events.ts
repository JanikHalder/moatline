import { eq } from "drizzle-orm";
import { db, orgIntegrations } from "db";
import { decryptSecret, isEncrypted } from "./crypto";

/**
 * What Moatline did, sent to the organization's observability tools so it
 * shows next to their data: deploys and their outcome, rollbacks, fix pull
 * requests, incidents.
 *
 * - OTLP/HTTP logs (Dash0, Grafana Cloud, SigNoz, Honeycomb, New Relic …)
 * - Grafana annotations — the "deployed here" line on dashboards
 * - a webhook with the event as JSON, for anything else
 *
 * Fire and forget: a tool that is down must never slow a deploy.
 */

export type MoatlineEvent = {
  /** e.g. "deploy.started", "deploy.healthy", "deploy.rolled_back". */
  name: string;
  /** One line for people. */
  title: string;
  severity: "info" | "warn" | "error";
  repository?: { id: string; name: string; githubUrl?: string | null };
  /** Extra facts: commit, platform, url, verdict … */
  attributes?: Record<string, string | number | boolean | null | undefined>;
  at?: Date;
};

type Targets = {
  otlp: { endpoint: string; headers: Record<string, string> } | null;
  grafana: { url: string; token: string } | null;
  webhook: string | null;
};

const open = (v: string | null) => {
  if (!v) return null;
  try {
    return isEncrypted(v) ? decryptSecret(v) : v;
  } catch {
    return null;
  }
};

/** "Key: value" lines → headers; anything else is skipped. */
export function parseHeaders(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (/^[A-Za-z0-9-]{1,64}$/.test(k) && v) out[k] = v;
  }
  return out;
}

async function targets(organizationId: string): Promise<Targets | null> {
  const [row] = await db
    .select({
      otlpEndpoint: orgIntegrations.otlpEndpoint,
      otlpHeaders: orgIntegrations.otlpHeaders,
      grafanaUrl: orgIntegrations.grafanaUrl,
      grafanaToken: orgIntegrations.grafanaToken,
      eventWebhookUrl: orgIntegrations.eventWebhookUrl,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId));
  if (!row) return null;
  const grafanaToken = open(row.grafanaToken);
  return {
    otlp: row.otlpEndpoint
      ? {
          endpoint: row.otlpEndpoint,
          headers: parseHeaders(open(row.otlpHeaders)),
        }
      : null,
    grafana:
      row.grafanaUrl && grafanaToken
        ? { url: row.grafanaUrl, token: grafanaToken }
        : null,
    webhook: open(row.eventWebhookUrl),
  };
}

type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };
const otlpValue = (v: string | number | boolean): OtlpValue =>
  typeof v === "boolean"
    ? { boolValue: v }
    : typeof v === "number"
      ? Number.isInteger(v)
        ? { intValue: String(v) }
        : { doubleValue: v }
      : { stringValue: v };

const attrs = (
  o: Record<string, string | number | boolean | null | undefined>
) =>
  Object.entries(o)
    .filter((e): e is [string, string | number | boolean] => e[1] != null)
    .map(([key, v]) => ({ key, value: otlpValue(v) }));

/** One OTLP/HTTP JSON logs request with the event as a log record. */
export function otlpBody(e: MoatlineEvent) {
  const at = (e.at ?? new Date()).getTime();
  return {
    resourceLogs: [
      {
        resource: {
          attributes: attrs({
            "service.name": e.repository?.name ?? "moatline",
            "moatline.repository.id": e.repository?.id,
            "vcs.repository.url.full": e.repository?.githubUrl ?? undefined,
          }),
        },
        scopeLogs: [
          {
            scope: { name: "moatline" },
            logRecords: [
              {
                timeUnixNano: `${at}000000`,
                severityText:
                  e.severity === "error"
                    ? "ERROR"
                    : e.severity === "warn"
                      ? "WARN"
                      : "INFO",
                severityNumber:
                  e.severity === "error" ? 17 : e.severity === "warn" ? 13 : 9,
                body: { stringValue: e.title },
                attributes: attrs({
                  "event.name": `moatline.${e.name}`,
                  ...e.attributes,
                }),
              },
            ],
          },
        ],
      },
    ],
  };
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Where to send OTLP logs: the endpoint as given, with /v1/logs added. */
export function otlpLogsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return base.endsWith("/v1/logs") ? base : `${base}/v1/logs`;
}

/** Send to every configured tool. Returns what failed, for the test button. */
export async function sendEvent(
  organizationId: string,
  e: MoatlineEvent
): Promise<{
  sent: string[];
  failed: Array<{ target: string; error: string }>;
}> {
  const t = await targets(organizationId).catch(() => null);
  const sent: string[] = [];
  const failed: Array<{ target: string; error: string }> = [];
  if (!t) return { sent, failed };
  const jobs: Array<[string, Promise<void>]> = [];
  if (t.otlp)
    jobs.push([
      "OTLP",
      post(otlpLogsUrl(t.otlp.endpoint), t.otlp.headers, otlpBody(e)),
    ]);
  if (t.grafana)
    jobs.push([
      "Grafana",
      post(
        `${t.grafana.url.replace(/\/+$/, "")}/api/annotations`,
        { Authorization: `Bearer ${t.grafana.token}` },
        {
          time: (e.at ?? new Date()).getTime(),
          tags: [
            "moatline",
            e.name,
            ...(e.repository ? [e.repository.name] : []),
          ],
          text: e.title,
        }
      ),
    ]);
  if (t.webhook)
    jobs.push([
      "Webhook",
      post(
        t.webhook,
        {},
        { source: "moatline", ...e, at: (e.at ?? new Date()).toISOString() }
      ),
    ]);
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  results.forEach((r, i) => {
    const target = jobs[i]![0];
    if (r.status === "fulfilled") sent.push(target);
    else
      failed.push({
        target,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
  });
  return { sent, failed };
}

/** Fire and forget, for the places where things happen. */
export function emitEvent(organizationId: string, e: MoatlineEvent): void {
  void sendEvent(organizationId, e)
    .then((r) => {
      for (const f of r.failed)
        console.error(`[events] ${f.target}: ${f.error}`);
    })
    .catch(() => {});
}
