import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { cronChecks, db } from "db";
import { notify } from "../lib/notify";

/**
 * Scheduled jobs that report in — backups, cleanups, imports. Each calls its
 * URL after a run; silence beyond its period plus grace is an alarm. The
 * watcher must not go down with what it watches, which is why this belongs
 * outside the job's own server.
 */

export type PingKind = "ok" | "fail" | "start";
type Row = typeof cronChecks.$inferSelect;

export const newToken = () => randomBytes(18).toString("base64url");

const MAX_PINGS = 30;

/** When a check that last pinged at `lastPingAt` is overdue. */
export function overdueAt(
  row: Pick<Row, "lastPingAt" | "periodSeconds" | "graceSeconds">
): Date | null {
  if (!row.lastPingAt) return null;
  return new Date(
    row.lastPingAt.getTime() + (row.periodSeconds + row.graceSeconds) * 1000
  );
}

/** A ping arrived: record it, and say when the job came back. */
export async function ping(
  token: string,
  kind: PingKind,
  now = new Date()
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(cronChecks)
    .where(eq(cronChecks.token, token));
  if (!row) return false;
  const pings = [
    ...row.pings,
    {
      at: now.toISOString(),
      kind,
      ...(kind === "ok" &&
      row.lastStartAt &&
      row.lastStartAt > (row.lastPingAt ?? new Date(0))
        ? { ms: now.getTime() - row.lastStartAt.getTime() }
        : {}),
    },
  ].slice(-MAX_PINGS);

  if (kind === "start") {
    await db
      .update(cronChecks)
      .set({ lastStartAt: now, pings })
      .where(eq(cronChecks.id, row.id));
    return true;
  }
  const failed = kind === "fail";
  await db
    .update(cronChecks)
    .set({
      pings,
      lastPingAt: now,
      status: failed ? "down" : "up",
      downSince: failed ? (row.status === "down" ? row.downSince : now) : null,
    })
    .where(eq(cronChecks.id, row.id));
  if (failed && row.status !== "down")
    await notify(row.organizationId, {
      type: "server_alert",
      title: `Job "${row.name}" failed`,
      message: "It reported a failure. Its log says why.",
    }).catch(() => {});
  if (!failed && row.status === "down")
    await notify(row.organizationId, {
      type: "server_alert",
      title: `Job "${row.name}" runs again`,
      message: row.downSince
        ? `Back after ${Math.max(1, Math.round((now.getTime() - row.downSince.getTime()) / 60000))} min.`
        : "It reported in again.",
    }).catch(() => {});
  return true;
}

/** Every minute: jobs that went silent. */
export async function checkOverdue(now = new Date()): Promise<void> {
  const rows = await db
    .select()
    .from(cronChecks)
    .where(
      and(ne(cronChecks.status, "down"), isNotNull(cronChecks.lastPingAt))
    );
  for (const row of rows) {
    const due = overdueAt(row);
    if (!due || due > now) continue;
    await db
      .update(cronChecks)
      .set({ status: "down", downSince: due })
      .where(eq(cronChecks.id, row.id));
    await notify(row.organizationId, {
      type: "server_alert",
      title: `Job "${row.name}" did not run`,
      message: `It last reported in ${row.lastPingAt!.toISOString().replace("T", " ").slice(0, 16)} UTC and was expected every ${human(row.periodSeconds)}. Check the job and the machine it runs on.`,
    }).catch(() => {});
  }
}

export function human(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}
