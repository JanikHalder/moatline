import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db, incidents, repositories, statusPages } from "db";
import { uptimeOf } from "./incidents";
import { covers, openWindows } from "./maintenance";

/**
 * Public status pages: the sites an organization chooses, whether they are
 * up, their uptime over 90 days day by day, and recent outages. Nothing
 * internal leaves here — no causes, logs, URLs or ids of other things.
 */

const DAY = 24 * 60 * 60 * 1000;
export const DAYS = 90;

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
/** Paths a slug must not take over. */
const RESERVED = new Set(["admin", "api", "app", "status", "www", "login"]);
export const slugOk = (s: string) => SLUG.test(s) && !RESERVED.has(s);

type Outage = { startedAt: Date; resolvedAt: Date | null };

/** Minutes down on each of the last `days` days (UTC), oldest first. */
export function dailyDowntime(
  rows: Outage[],
  now: number,
  days = DAYS
): Array<{ date: string; downMinutes: number }> {
  const today = Math.floor(now / DAY) * DAY;
  const out: Array<{ date: string; downMinutes: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = today - i * DAY;
    const to = Math.min(from + DAY, now);
    let down = 0;
    for (const r of rows) {
      const s = Math.max(from, r.startedAt.getTime());
      const e = Math.min(to, r.resolvedAt?.getTime() ?? now);
      if (e > s) down += e - s;
    }
    out.push({
      date: new Date(from).toISOString().slice(0, 10),
      downMinutes: Math.round(down / 60_000),
    });
  }
  return out;
}

export type PublicStatus = {
  title: string;
  description: string | null;
  /** up: every component up; partial: some down; down: all down. */
  overall: "up" | "partial" | "down" | "maintenance" | "unknown";
  components: Array<{
    name: string;
    state: "up" | "down" | "maintenance" | "unknown";
    uptime90: number;
    days: Array<{ date: string; downMinutes: number }>;
  }>;
  incidents: Array<{
    component: string;
    startedAt: string;
    resolvedAt: string | null;
  }>;
  updatedAt: string;
};

/** The published page for a slug, or null. */
export async function publicStatus(
  slug: string,
  now = Date.now()
): Promise<PublicStatus | null> {
  const [page] = await db
    .select()
    .from(statusPages)
    .where(and(eq(statusPages.slug, slug), eq(statusPages.published, true)));
  if (!page) return null;
  const ids = page.components.map((c) => c.repositoryId);
  const [repos, rows] = ids.length
    ? await Promise.all([
        db
          .select({
            id: repositories.id,
            liveStatus: repositories.liveStatus,
            liveUrl: repositories.liveUrl,
            serverId: repositories.serverId,
          })
          .from(repositories)
          .where(
            and(
              inArray(repositories.id, ids),
              // Only the page owner's sites, whatever was stored.
              eq(repositories.organizationId, page.organizationId)
            )
          ),
        db
          .select({
            repositoryId: incidents.repositoryId,
            startedAt: incidents.startedAt,
            resolvedAt: incidents.resolvedAt,
          })
          .from(incidents)
          .where(
            and(
              inArray(incidents.repositoryId, ids),
              eq(incidents.kind, "site_down"),
              or(
                gte(incidents.startedAt, new Date(now - DAYS * DAY)),
                isNull(incidents.resolvedAt)
              )
            )
          ),
      ])
    : [[], []];
  const byId = new Map(repos.map((r) => [r.id, r]));
  const windows = await openWindows(page.organizationId, new Date(now)).catch(
    () => []
  );
  const components = page.components
    .filter((c) => byId.has(c.repositoryId))
    .map((c) => {
      const repo = byId.get(c.repositoryId)!;
      const mine = rows.filter((r) => r.repositoryId === c.repositoryId);
      const open = mine.some((r) => !r.resolvedAt);
      const planned = windows.some((w) =>
        covers(w, { serverId: repo.serverId, repositoryId: c.repositoryId })
      );
      return {
        name: c.name,
        state: planned
          ? ("maintenance" as const)
          : open
            ? ("down" as const)
            : repo.liveUrl && repo.liveStatus === "up"
              ? ("up" as const)
              : repo.liveUrl && repo.liveStatus === "down"
                ? ("down" as const)
                : ("unknown" as const),
        uptime90: uptimeOf(mine, now - DAYS * DAY, now),
        days: dailyDowntime(mine, now),
      };
    });
  const known = components.filter((c) => c.state !== "unknown");
  const down = known.filter((c) => c.state === "down").length;
  const planned = known.filter((c) => c.state === "maintenance").length;
  const nameOf = new Map(page.components.map((c) => [c.repositoryId, c.name]));
  return {
    title: page.title,
    description: page.description,
    overall: !known.length
      ? "unknown"
      : down === 0 && planned > 0
        ? "maintenance"
        : down === 0
          ? "up"
          : down === known.length
            ? "down"
            : "partial",
    components,
    incidents: rows
      .filter((r) => r.startedAt.getTime() >= now - 30 * DAY || !r.resolvedAt)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, 20)
      .map((r) => ({
        component: nameOf.get(r.repositoryId) ?? "",
        startedAt: r.startedAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      })),
    updatedAt: new Date(now).toISOString(),
  };
}
