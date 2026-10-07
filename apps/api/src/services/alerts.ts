import crypto from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, incidents, orgIntegrations, repositories } from "db";
import { githubRepoOfUrl } from "../lib/dokploy";
import { notify } from "../lib/notify";
import { MAX_HEALS_PER_DAY } from "./incidents";
import { hasDeployTarget, platform, repoTarget } from "./platforms";

/**
 * Alerts from the organization's observability tools, as incidents. The
 * Alertmanager webhook format is what Prometheus Alertmanager and Grafana
 * send (and what many other tools can); a simple { title, status, service }
 * object works too. A firing alert opens an incident on the repository its
 * labels name, a resolved one closes it. Restarting is opt-in per alert:
 * the label moatline_action="restart".
 */

export type IncomingAlert = {
  id: string;
  status: "firing" | "resolved";
  title: string;
  description: string | null;
  labels: Record<string, string>;
  url: string | null;
};

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const record = (v: unknown): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => typeof x === "string")
          .slice(0, 50)
          .map(([k, x]) => [k.slice(0, 100), (x as string).slice(0, 500)])
      )
    : {};

const idOf = (labels: Record<string, string>) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(Object.entries(labels).sort()))
    .digest("hex")
    .slice(0, 16);

/** Alertmanager / Grafana webhook, or one plain alert object. */
export function parseAlerts(body: unknown): IncomingAlert[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(b.alerts) ? b.alerts : [b];
  return list
    .slice(0, 50)
    .map((raw): IncomingAlert | null => {
      const a = (raw ?? {}) as Record<string, unknown>;
      const labels = { ...record(b.commonLabels), ...record(a.labels) };
      const ann = { ...record(b.commonAnnotations), ...record(a.annotations) };
      const status = (str(a.status) ?? str(b.status) ?? "firing").toLowerCase();
      const title =
        ann.summary ?? str(a.title) ?? labels.alertname ?? str(b.title) ?? null;
      if (!title) return null;
      return {
        id: (
          str(a.fingerprint) ??
          str(a.id) ??
          idOf({ ...labels, title })
        ).slice(0, 100),
        status:
          status === "resolved" || status === "ok" ? "resolved" : "firing",
        title: title.slice(0, 300),
        description:
          (
            ann.description ??
            str(a.description) ??
            str(a.message) ??
            null
          )?.slice(0, 1000) ?? null,
        labels: str(a.service)
          ? { ...labels, service: str(a.service)! }
          : labels,
        url: str(a.generatorURL) ?? str(a.url) ?? str(b.externalURL),
      };
    })
    .filter((a): a is IncomingAlert => a !== null);
}

const SERVICE_LABELS = [
  "moatline_repo",
  "repository",
  "service",
  "service_name",
  "service.name",
  "app",
  "application",
  "job",
];

/** The repository an alert's labels name: its name, service or GitHub repo. */
export function repoForAlert<
  R extends {
    id: string;
    name: string;
    githubUrl: string;
    dokployAppName: string | null;
  },
>(labels: Record<string, string>, repos: R[]): R | null {
  for (const key of SERVICE_LABELS) {
    const v = labels[key]?.toLowerCase();
    if (!v) continue;
    const hit = repos.find(
      (r) =>
        r.name.toLowerCase() === v ||
        r.dokployAppName?.toLowerCase() === v ||
        githubRepoOfUrl(r.githubUrl) === v ||
        githubRepoOfUrl(r.githubUrl)?.split("/")[1] === v
    );
    if (hit) return hit;
  }
  return null;
}

/** The organization a receiver token belongs to. */
export async function orgForAlertToken(token: string): Promise<string | null> {
  if (!/^pcal_[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const [row] = await db
    .select({ organizationId: orgIntegrations.organizationId })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.alertTokenHash, hash));
  return row?.organizationId ?? null;
}

export function newAlertToken(): { token: string; hash: string } {
  const token = `pcal_${crypto.randomBytes(24).toString("base64url")}`;
  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
  };
}

type Step = { at: string; text: string };

export async function receiveAlerts(
  organizationId: string,
  alerts: IncomingAlert[],
  now = new Date()
): Promise<{ opened: number; resolved: number; unmatched: number }> {
  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  let opened = 0;
  let resolved = 0;
  let unmatched = 0;
  for (const a of alerts) {
    const repo = repoForAlert(a.labels, repos);
    if (!repo) {
      unmatched++;
      if (a.status === "firing")
        await notify(organizationId, {
          type: "server_alert",
          title: `Alert: ${a.title}`,
          message: [
            a.description,
            "No repository matched its labels (service, app, job …).",
          ]
            .filter(Boolean)
            .join("\n"),
          url: a.url ?? undefined,
        }).catch(() => {});
      continue;
    }
    const [open] = await db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.repositoryId, repo.id),
          eq(incidents.kind, "alert"),
          eq(incidents.externalId, a.id),
          isNull(incidents.resolvedAt)
        )
      );
    const step = (text: string): Step => ({ at: now.toISOString(), text });
    const url = appUrl ? `${appUrl}/repos/${repo.id}` : (a.url ?? undefined);

    if (a.status === "resolved") {
      if (!open) continue;
      resolved++;
      await db
        .update(incidents)
        .set({
          resolvedAt: now,
          timeline: [
            ...((open.timeline as Step[]) ?? []),
            step("Alert resolved"),
          ],
        })
        .where(eq(incidents.id, open.id));
      await notify(organizationId, {
        type: "server_alert",
        title: `${repo.name}: alert resolved — ${a.title}`,
        message: "The observability tool reports it resolved.",
        url,
      }).catch(() => {});
      continue;
    }
    if (open) continue; // repeated notifications of a firing alert
    opened++;
    const timeline: Step[] = [step(`Alert fired: ${a.title}`)];
    let healed = false;
    if (a.labels.moatline_action === "restart" && hasDeployTarget(repo)) {
      const [{ heals } = { heals: 0 }] = await db
        .select({
          heals: sql<number>`coalesce(sum(${incidents.healAttempts}), 0)::int`,
        })
        .from(incidents)
        .where(
          and(
            eq(incidents.repositoryId, repo.id),
            gte(
              incidents.startedAt,
              new Date(now.getTime() - 24 * 60 * 60 * 1000)
            )
          )
        );
      if (heals < MAX_HEALS_PER_DAY) {
        const target = repoTarget(repo)!;
        const p = platform(target.platform);
        const r = await p.restart(organizationId, target);
        healed = r.ok;
        timeline.push(
          step(
            r.ok ? `Restarted through ${p.label}` : `Restart failed: ${r.error}`
          )
        );
      }
    }
    await db.insert(incidents).values({
      organizationId,
      repositoryId: repo.id,
      kind: "alert",
      externalId: a.id,
      startedAt: now,
      cause: [a.title, a.description].filter(Boolean).join("\n"),
      timeline,
      healAttempts: healed ? 1 : 0,
      healedAt: healed ? now : null,
    });
    await notify(organizationId, {
      type: "server_alert",
      title: `${repo.name}: ${a.title}`,
      message: [
        a.description,
        healed
          ? "Restarted, as the alert asks (moatline_action=restart)."
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      url,
    }).catch(() => {});
  }
  return { opened, resolved, unmatched };
}
