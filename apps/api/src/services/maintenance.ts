import { and, eq, gt, lte } from "drizzle-orm";
import { db, maintenanceWindows, repositories } from "db";

/**
 * Planned work. While a window is open, alerts for what it covers are held
 * back and status pages show maintenance — a planned restart is not an
 * outage, and a phone that rings for one teaches people to ignore it.
 */

export type Scope = { serverId?: string | null; repositoryId?: string | null };

type Window = typeof maintenanceWindows.$inferSelect;

/** Whether a window covers a server or repository (the repo's server too). */
export function covers(
  w: Pick<Window, "scope" | "targetId">,
  target: { serverId?: string | null; repositoryId?: string | null }
): boolean {
  if (w.scope === "organization") return true;
  if (w.scope === "server")
    return !!w.targetId && w.targetId === target.serverId;
  return !!w.targetId && w.targetId === target.repositoryId;
}

/** Windows of an organization open at `at`. */
export async function openWindows(
  organizationId: string,
  at = new Date()
): Promise<Window[]> {
  return db
    .select()
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.organizationId, organizationId),
        lte(maintenanceWindows.startsAt, at),
        gt(maintenanceWindows.endsAt, at)
      )
    );
}

/** The open window covering a server or repository, if any. */
export async function inMaintenance(
  organizationId: string,
  scope: Scope,
  at = new Date()
): Promise<Window | null> {
  const open = await openWindows(organizationId, at);
  if (!open.length) return null;
  let serverId = scope.serverId ?? null;
  // A repository is also covered by its server's window.
  if (!serverId && scope.repositoryId) {
    const [repo] = await db
      .select({ serverId: repositories.serverId })
      .from(repositories)
      .where(eq(repositories.id, scope.repositoryId));
    serverId = repo?.serverId ?? null;
  }
  return (
    open.find((w) =>
      covers(w, { serverId, repositoryId: scope.repositoryId ?? null })
    ) ?? null
  );
}
