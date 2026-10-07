import { and, eq, gte, inArray } from "drizzle-orm";
import { db, deployRuns, repositories } from "db";
import type { FindingInput } from "../lib/server-findings";

/**
 * The kernel killing processes because the whole server ran out of memory
 * (not a container hitting its own limit). Dokploy and Coolify build on the
 * server the sites run on unless told otherwise — a big Next.js build then
 * takes the memory and the kernel kills the biggest process, often the app.
 */

export type OomEvent = {
  at: string;
  /** Kills since the previous report. */
  count: number;
  victims: string[];
  /** Repositories on this server deployed shortly before. */
  duringDeploy: string[];
};

/** A deploy counts if it started within this window before the kill. */
const DEPLOY_WINDOW_MS = 20 * 60 * 1000;
/** The finding stays this long after the last kill. */
const SHOW_MS = 24 * 60 * 60 * 1000;

/** New kills between two reports, from the kernel's counter. */
export function newKills(
  prev: number | null | undefined,
  now: number | null | undefined
): number {
  if (now == null || prev == null) return 0;
  // A reboot resets the counter.
  return now >= prev ? now - prev : now;
}

/** Deployed repositories on a server in the window before `at`. */
export async function deploysBefore(
  serverId: string,
  at: Date
): Promise<string[]> {
  const repos = await db
    .select({ id: repositories.id, name: repositories.name })
    .from(repositories)
    .where(eq(repositories.serverId, serverId));
  if (!repos.length) return [];
  const runs = await db
    .select({ repositoryId: deployRuns.repositoryId })
    .from(deployRuns)
    .where(
      and(
        inArray(
          deployRuns.repositoryId,
          repos.map((r) => r.id)
        ),
        gte(deployRuns.triggeredAt, new Date(at.getTime() - DEPLOY_WINDOW_MS))
      )
    );
  const ids = new Set(runs.map((r) => r.repositoryId));
  return repos.filter((r) => ids.has(r.id)).map((r) => r.name);
}

/** The finding for the last OOM event, while it is recent. */
export function oomFindings(
  event: OomEvent | null | undefined,
  now = Date.now()
): FindingInput[] {
  if (!event || now - Date.parse(event.at) > SHOW_MS) return [];
  const who = event.victims.length
    ? `It killed ${[...new Set(event.victims)].slice(0, 5).join(", ")}`
    : "It killed processes";
  if (event.duringDeploy.length)
    return [
      {
        fingerprint: "oom:build",
        severity: "high",
        title: "A deploy ran the server out of memory",
        detail: `The kernel ran out of memory while ${event.duringDeploy.join(", ")} deployed. ${who} — running sites go down with it. Builds on the server the sites run on take the memory they need: build on a separate build server (Dokploy: Settings → Build server; Coolify: a build server), or give the build a memory limit and add swap.`,
      },
    ];
  return [
    {
      fingerprint: "oom:host",
      severity: "high",
      title: "The server ran out of memory",
      detail: `The kernel ran out of memory (${event.count}× since the previous report). ${who}. Limit the apps' memory (and NODE_OPTIONS=--max-old-space-size for Node), add swap, or move work to another server.`,
    },
  ];
}
