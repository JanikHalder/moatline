import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db, deployRuns, incidents, repositories } from "db";
import { notify } from "../lib/notify";
import { hasDeployTarget, platform, repoTarget } from "./platforms";
import { errorSummary } from "./log-errors";
import { emitEvent } from "../lib/events";
import { confirmation, type Confirmation } from "./probes";
import { notifyDown } from "./down-batch";

const MIN = 60 * 1000;
/** Down this long before self-healing restarts the app. */
export const HEAL_AFTER_MS = 5 * MIN;
/** After a restart: still down this long → tell a person. */
export const ESCALATE_AFTER_HEAL_MS = 10 * MIN;
/** Without self-healing: down this long → remind once. */
export const ESCALATE_AFTER_MS = 30 * MIN;
/** Restarts per site and day — beyond that a restart loop helps nobody. */
export const MAX_HEALS_PER_DAY = 3;
/** Deploys take sites down briefly; the deploy guard judges those. */
const DEPLOY_WINDOW_MS = 15 * MIN;

type Open = {
  startedAt: Date;
  healAttempts: number;
  healedAt: Date | null;
  escalatedAt: Date | null;
};

export type IncidentAction = "open" | "heal" | "escalate" | "resolve" | null;

/** What to do after a live check — pure, so every rule is testable. */
export function decideIncident(s: {
  ok: boolean;
  failures: number;
  open: Open | null;
  autoHeal: boolean;
  deploying: boolean;
  healsToday: number;
  now: number;
  /** What other locations say (probes); "none" without probes. */
  confirm?: Confirmation["state"];
}): IncidentAction {
  if (s.ok) return s.open ? "resolve" : null;
  if (!s.open) {
    if (s.failures < 2 || s.deploying) return null;
    const c = s.confirm ?? "none";
    // Reached from elsewhere: the route from here broke, not the site.
    if (c === "up") return null;
    // Probes silent: do not wait for them forever.
    if (c === "pending") return s.failures >= 4 ? "open" : null;
    return "open";
  }
  const down = s.now - s.open.startedAt.getTime();
  const canHeal = s.autoHeal && s.healsToday < MAX_HEALS_PER_DAY;
  if (
    canHeal &&
    s.open.healAttempts === 0 &&
    down >= HEAL_AFTER_MS &&
    !s.deploying
  )
    return "heal";
  if (s.open.escalatedAt) return null;
  if (
    s.open.healAttempts > 0 &&
    s.open.healedAt &&
    s.now - s.open.healedAt.getTime() >= ESCALATE_AFTER_HEAL_MS
  )
    return "escalate";
  if (s.open.healAttempts === 0 && !canHeal && down >= ESCALATE_AFTER_MS)
    return "escalate";
  return null;
}

/** Restart the app where it runs, without rebuilding it. */
async function restartApp(
  repo: Parameters<typeof repoTarget>[0] & { organizationId: string }
): Promise<{ ok: boolean; status: number; body: string; via: string }> {
  const target = repoTarget(repo);
  if (!target)
    return { ok: false, status: 0, body: "no platform linked", via: "Dokploy" };
  const p = platform(target.platform);
  const r = await p.restart(repo.organizationId, target);
  return { ok: r.ok, status: 0, body: r.ok ? "" : r.error, via: p.label };
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / MIN));

type Step = { at: string; text: string };

/**
 * Called with every live check result: opens, heals, escalates and closes
 * incidents, and sends the notifications that go with each.
 */
export async function onLiveResult(
  repo: {
    id: string;
    name: string;
    organizationId: string;
    autoHeal: boolean;
    liveFailures: number;
    liveUrl: string | null;
    dokployApplicationId: string | null;
    dokployAppName: string | null;
    dokployKind: "application" | "compose" | null;
    coolifyAppUuid: string | null;
    serverId?: string | null;
  },
  result: { ok: boolean; error: string | null; httpStatus: number | null },
  now = new Date()
): Promise<void> {
  const [open] = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.repositoryId, repo.id),
        // Alerts from other tools have their own lifecycle.
        eq(incidents.kind, "site_down"),
        isNull(incidents.resolvedAt)
      )
    )
    .orderBy(desc(incidents.startedAt))
    .limit(1);
  const [deploy] = await db
    .select({ at: deployRuns.triggeredAt })
    .from(deployRuns)
    .where(
      and(
        eq(deployRuns.repositoryId, repo.id),
        gte(deployRuns.triggeredAt, new Date(now.getTime() - DEPLOY_WINDOW_MS))
      )
    )
    .limit(1);
  const [{ heals } = { heals: 0 }] = await db
    .select({
      heals: sql<number>`coalesce(sum(${incidents.healAttempts}), 0)::int`,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.repositoryId, repo.id),
        gte(incidents.startedAt, new Date(now.getTime() - 24 * 60 * MIN))
      )
    );
  // Ask the other locations only when an outage is about to open.
  const confirmed =
    !result.ok && !open && repo.liveFailures >= 2
      ? await confirmation(repo.id, now).catch(
          (): Confirmation => ({ state: "none", down: [], up: [] })
        )
      : null;
  const action = decideIncident({
    ok: result.ok,
    failures: repo.liveFailures,
    open: open ?? null,
    autoHeal: repo.autoHeal && hasDeployTarget(repo),
    deploying: !!deploy,
    healsToday: heals,
    now: now.getTime(),
    confirm: confirmed?.state,
  });
  if (!action) return;

  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  const url = appUrl
    ? `${appUrl}/repos/${repo.id}`
    : (repo.liveUrl ?? undefined);
  const step = (text: string): Step => ({ at: now.toISOString(), text });
  const timeline = ((open?.timeline as Step[] | undefined) ?? []).slice(-50);
  const send = (title: string, message: string) => {
    emitEvent(repo.organizationId, {
      name: `incident.${action}`,
      title,
      severity:
        action === "resolve" ? "info" : action === "heal" ? "warn" : "error",
      repository: { id: repo.id, name: repo.name },
      attributes: { detail: message, "url.full": repo.liveUrl ?? undefined },
    });
    const event = {
      type: "server_alert" as const,
      title,
      message,
      url,
      scope: { repositoryId: repo.id, serverId: repo.serverId ?? null },
    };
    // Outages are grouped per server; the rest goes out at once.
    return (
      action === "open"
        ? notifyDown(repo.organizationId, repo.serverId, repo.name, event)
        : notify(repo.organizationId, event)
    ).catch(() => {});
  };

  if (action === "open") {
    const what =
      result.error ??
      (result.httpStatus ? `HTTP ${result.httpStatus}` : "no answer");
    // What the app logged just now is the best guess at why.
    const logs = await errorSummary({ repositoryId: repo.id }, 1).catch(
      () => []
    );
    const hints = logs.slice(0, 3).map((e) => `${e.recent}× ${e.sample}`);
    const where =
      confirmed?.state === "down"
        ? `Confirmed from ${confirmed.down.join(", ")}.`
        : confirmed?.state === "pending"
          ? "The other locations did not answer; opened after four failures."
          : null;
    const cause = [what, ...(where ? [where] : []), ...hints].join("\n");
    await db.insert(incidents).values({
      organizationId: repo.organizationId,
      repositoryId: repo.id,
      startedAt: now,
      cause,
      timeline: [step(`Down: ${what}${where ? ` ${where}` : ""}`)],
    });
    await send(
      `${repo.name} is down`,
      [
        `The site does not answer: ${what}.`,
        ...(where ? [where] : []),
        ...(hints.length ? ["Errors in the logs:", ...hints] : []),
        ...(repo.autoHeal && hasDeployTarget(repo)
          ? ["Self-healing restarts it if it stays down for 5 minutes."]
          : []),
      ].join("\n")
    );
    return;
  }
  if (!open) return;
  const down = now.getTime() - open.startedAt.getTime();

  if (action === "heal") {
    const res = await restartApp(repo);
    await db
      .update(incidents)
      .set({
        healAttempts: open.healAttempts + 1,
        healedAt: now,
        timeline: [
          ...timeline,
          step(
            res.ok
              ? `Restarted through ${res.via} (down for ${minutes(down)} min)`
              : `Restart failed: ${res.body || `HTTP ${res.status}`}`
          ),
        ],
      })
      .where(eq(incidents.id, open.id));
    await send(
      res.ok
        ? `${repo.name}: restarting through ${res.via}`
        : `${repo.name}: self-healing could not restart it`,
      res.ok
        ? `Down for ${minutes(down)} min. Moatline restarted the app and keeps checking.`
        : `${res.via} refused the restart: ${res.body || `HTTP ${res.status}`}`
    );
    return;
  }
  if (action === "escalate") {
    await db
      .update(incidents)
      .set({
        escalatedAt: now,
        timeline: [...timeline, step(`Still down after ${minutes(down)} min`)],
      })
      .where(eq(incidents.id, open.id));
    await send(
      open.healAttempts > 0
        ? `${repo.name} is still down after the restart`
        : `${repo.name} has been down for ${minutes(down)} min`,
      `Down since ${open.startedAt.toISOString().slice(11, 16)} UTC. Someone needs to look at it.`
    );
    return;
  }
  // resolve
  await db
    .update(incidents)
    .set({
      resolvedAt: now,
      timeline: [...timeline, step(`Back up after ${minutes(down)} min`)],
    })
    .where(eq(incidents.id, open.id));
  await send(
    `${repo.name} is back up after ${minutes(down)} min`,
    open.healAttempts > 0
      ? `The restart through ${platform(repoTarget(repo)?.platform ?? "dokploy").label} helped.`
      : "It recovered on its own."
  );
}

/** Downtime share of a period from incidents overlapping it. */
export function uptimeOf(
  rows: Array<{ startedAt: Date; resolvedAt: Date | null }>,
  from: number,
  to: number
): number {
  let down = 0;
  for (const r of rows) {
    const s = Math.max(from, r.startedAt.getTime());
    const e = Math.min(to, r.resolvedAt?.getTime() ?? to);
    if (e > s) down += e - s;
  }
  return Math.max(0, 1 - down / (to - from));
}

/** Uptime over 30 and 90 days, and the incidents of the last 90. */
export async function repoIncidents(repositoryId: string, now = Date.now()) {
  const from90 = now - 90 * 24 * 60 * MIN;
  const rows = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.repositoryId, repositoryId),
        or(
          gte(incidents.startedAt, new Date(from90)),
          isNull(incidents.resolvedAt)
        )
      )
    )
    .orderBy(desc(incidents.startedAt))
    .limit(100);
  // Alerts are incidents too, but only the site being down costs uptime.
  const outages = rows.filter((r) => r.kind === "site_down");
  return {
    uptime30: uptimeOf(outages, now - 30 * 24 * 60 * MIN, now),
    uptime90: uptimeOf(outages, from90, now),
    incidents: rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      cause: r.cause,
      timeline: r.timeline as Step[],
      healAttempts: r.healAttempts,
      kind: r.kind,
    })),
  };
}

/** Open incidents of an organization, for the overview. */
export async function openIncidents(organizationId: string) {
  return db
    .select({
      id: incidents.id,
      repositoryId: incidents.repositoryId,
      name: repositories.name,
      startedAt: incidents.startedAt,
      cause: incidents.cause,
      healAttempts: incidents.healAttempts,
    })
    .from(incidents)
    .innerJoin(repositories, eq(repositories.id, incidents.repositoryId))
    .where(
      and(
        eq(incidents.organizationId, organizationId),
        eq(incidents.kind, "site_down"),
        isNull(incidents.resolvedAt)
      )
    )
    .orderBy(desc(incidents.startedAt));
}
