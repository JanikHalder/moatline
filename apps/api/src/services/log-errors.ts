import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, deployRuns, logErrorCounts, logErrors, repositories } from "db";
import { notify } from "../lib/notify";
import { repoForApp } from "./dokploy-sync";

export type ReportedLogError = {
  fingerprint: string;
  app: string;
  container?: string | null;
  sample: string;
  count: number;
  firstAt?: string | null;
  lastAt?: string | null;
};

const HOUR = 60 * 60 * 1000;
/** A new error this often within its first hour is worth a message. */
export const NOTIFY_AFTER = 20;
const COUNTS_RETENTION_MS = 14 * 24 * HOUR;
const ERRORS_RETENTION_MS = 30 * 24 * HOUR;

/**
 * Store what the agent saw: one row per kind of error, a count per report.
 * A new kind of error that keeps coming is sent as a notification once —
 * with the deploy it started after, when there was one.
 */
export async function ingestLogErrors(
  server: { id: string; name: string; organizationId: string },
  errors: ReportedLogError[],
  repoByApp: Map<string, string>,
  now = new Date()
): Promise<void> {
  if (!errors.length) return;
  for (const e of errors) {
    const repositoryId = repoForApp(e.app, repoByApp);
    const [row] = await db
      .insert(logErrors)
      .values({
        serverId: server.id,
        repositoryId,
        app: e.app,
        fingerprint: e.fingerprint,
        sample: e.sample,
        total: e.count,
        firstSeen: now,
        lastSeen: now,
      })
      .onConflictDoUpdate({
        target: [logErrors.serverId, logErrors.fingerprint],
        set: {
          sample: e.sample,
          repositoryId,
          total: sql`${logErrors.total} + ${e.count}`,
          lastSeen: now,
        },
      })
      .returning({ id: logErrors.id });
    if (row)
      await db
        .insert(logErrorCounts)
        .values({ errorId: row.id, recordedAt: now, count: e.count });
  }
  await notifyNewErrors(server, now);
  // A deploy that looked healthy but made the errors jump.
  const repos = errors
    .map((e) => repoForApp(e.app, repoByApp))
    .filter((id): id is string => !!id);
  if (repos.length) {
    const { checkErrorSpikes } = await import("./deploy-errors");
    await checkErrorSpikes(repos, now).catch((e) =>
      console.error("[deploy] error spike check failed:", e)
    );
  }
}

async function notifyNewErrors(
  server: { id: string; name: string; organizationId: string },
  now: Date
): Promise<void> {
  const since = new Date(now.getTime() - HOUR);
  const fresh = await db
    .select()
    .from(logErrors)
    .where(
      and(
        eq(logErrors.serverId, server.id),
        isNull(logErrors.notifiedAt),
        gte(logErrors.firstSeen, since),
        gte(logErrors.total, NOTIFY_AFTER)
      )
    )
    .limit(5);
  if (!fresh.length) return;
  await db
    .update(logErrors)
    .set({ notifiedAt: now })
    .where(
      inArray(
        logErrors.id,
        fresh.map((f) => f.id)
      )
    );
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  for (const f of fresh) {
    const [repo] = f.repositoryId
      ? await db
          .select({ id: repositories.id, name: repositories.name })
          .from(repositories)
          .where(eq(repositories.id, f.repositoryId))
      : [];
    const [deploy] = repo
      ? await db
          .select({ at: deployRuns.triggeredAt })
          .from(deployRuns)
          .where(
            and(
              eq(deployRuns.repositoryId, repo.id),
              lt(deployRuns.triggeredAt, f.firstSeen),
              gte(
                deployRuns.triggeredAt,
                new Date(f.firstSeen.getTime() - 2 * HOUR)
              )
            )
          )
          .orderBy(desc(deployRuns.triggeredAt))
          .limit(1)
      : [];
    const where = repo?.name ?? f.app;
    await notify(server.organizationId, {
      type: "server_alert",
      title: `New error in ${where}: ${f.total}× within an hour`,
      message: [
        f.sample,
        deploy
          ? `Started after the deploy at ${deploy.at.toISOString().slice(11, 16)} UTC.`
          : `On ${server.name}.`,
      ].join("\n"),
      url: appUrl
        ? repo
          ? `${appUrl}/repos/${repo.id}`
          : `${appUrl}/servers/${server.id}`
        : undefined,
    }).catch(() => {});
  }
}

export async function pruneLogErrors(now = Date.now()): Promise<void> {
  await db
    .delete(logErrorCounts)
    .where(lt(logErrorCounts.recordedAt, new Date(now - COUNTS_RETENTION_MS)));
  await db
    .delete(logErrors)
    .where(lt(logErrors.lastSeen, new Date(now - ERRORS_RETENTION_MS)));
}

export type ErrorSummary = {
  id: string;
  app: string;
  sample: string;
  total: number;
  firstSeen: string;
  lastSeen: string;
  /** Count in the window, and per hour for a sparkline (oldest first). */
  recent: number;
  hourly: number[];
};

/**
 * The errors of a repository's app or a server's containers in the last
 * `hours`, most frequent first, with an hourly series.
 */
export async function errorSummary(
  where: { repositoryId: string } | { serverId: string; app?: string },
  hours = 24,
  now = Date.now()
): Promise<ErrorSummary[]> {
  const since = new Date(now - hours * HOUR);
  const cond =
    "repositoryId" in where
      ? eq(logErrors.repositoryId, where.repositoryId)
      : where.app
        ? and(
            eq(logErrors.serverId, where.serverId),
            eq(logErrors.app, where.app)
          )
        : eq(logErrors.serverId, where.serverId);
  const rows = await db
    .select()
    .from(logErrors)
    .where(and(cond, gte(logErrors.lastSeen, since)))
    .orderBy(desc(logErrors.lastSeen))
    .limit(100);
  if (!rows.length) return [];
  const counts = await db
    .select({
      errorId: logErrorCounts.errorId,
      recordedAt: logErrorCounts.recordedAt,
      count: logErrorCounts.count,
    })
    .from(logErrorCounts)
    .where(
      and(
        inArray(
          logErrorCounts.errorId,
          rows.map((r) => r.id)
        ),
        gte(logErrorCounts.recordedAt, since)
      )
    );
  return rows
    .map((r) => {
      const hourly = new Array<number>(hours).fill(0);
      let recent = 0;
      for (const c of counts) {
        if (c.errorId !== r.id) continue;
        recent += c.count;
        const slot = Math.min(
          hours - 1,
          Math.floor((c.recordedAt.getTime() - since.getTime()) / HOUR)
        );
        if (slot >= 0) hourly[slot]! += c.count;
      }
      return {
        id: r.id,
        app: r.app,
        sample: r.sample,
        total: r.total,
        firstSeen: r.firstSeen.toISOString(),
        lastSeen: r.lastSeen.toISOString(),
        recent,
        hourly,
      };
    })
    .sort((a, b) => b.recent - a.recent);
}
