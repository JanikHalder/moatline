import { and, eq, isNull } from "drizzle-orm";
import { db, serverFindings, servers } from "db";
import { notify, type NotifyEvent } from "../lib/notify";

/**
 * Sites going down together are usually one problem: their server. Outage
 * messages for sites on the same server are held for a minute and sent as
 * one — and when the server's agent went silent too, the message says the
 * server is the likely cause instead of listing symptoms.
 */

export const HOLD_MS = 60 * 1000;

type Pending = {
  orgId: string;
  serverId: string;
  items: Array<{ name: string; event: NotifyEvent }>;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

/** One message for several sites; pure, for testing. */
export function combine(
  serverName: string,
  items: Array<{ name: string; event: NotifyEvent }>,
  agentSilent: boolean
): NotifyEvent {
  if (items.length === 1) return items[0]!.event;
  const names = items.map((i) => i.name);
  return {
    type: "server_alert",
    title: `${items.length} sites on ${serverName} are down`,
    message: [
      agentSilent
        ? `${serverName}'s agent stopped reporting too — the server itself is the likely cause.`
        : `They went down within a minute of each other — look at ${serverName} first.`,
      ...names.map((n) => `• ${n}`),
    ].join("\n"),
    url: items[0]!.event.url,
    scope: { serverId: items[0]!.event.scope?.serverId ?? null },
  };
}

async function flush(key: string): Promise<void> {
  const p = pending.get(key);
  pending.delete(key);
  if (!p) return;
  const [server] = await db
    .select({ name: servers.name })
    .from(servers)
    .where(eq(servers.id, p.serverId));
  const [silent] = await db
    .select({ id: serverFindings.id })
    .from(serverFindings)
    .where(
      and(
        eq(serverFindings.serverId, p.serverId),
        eq(serverFindings.source, "heartbeat"),
        isNull(serverFindings.resolvedAt)
      )
    )
    .limit(1);
  const event = combine(server?.name ?? "the server", p.items, !!silent);
  await notify(p.orgId, {
    ...event,
    scope: { ...event.scope, serverId: p.serverId },
  }).catch(() => {});
}

/**
 * Send an outage message — at once for a site without a server, else after
 * a minute, together with the others on its server that went down meanwhile.
 */
export async function notifyDown(
  orgId: string,
  serverId: string | null | undefined,
  name: string,
  event: NotifyEvent
): Promise<void> {
  if (!serverId) return notify(orgId, event);
  const key = `${orgId}:${serverId}`;
  const p = pending.get(key);
  if (p) {
    p.items.push({ name, event });
    return;
  }
  const timer = setTimeout(() => void flush(key), HOLD_MS);
  timer.unref?.();
  pending.set(key, { orgId, serverId, items: [{ name, event }], timer });
}
