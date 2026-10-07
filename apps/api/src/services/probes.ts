import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db, probeResults, repositories } from "db";

/**
 * Probes: small checkers in other locations (moatline-probe). A site that
 * fails here is only called down once another location sees it fail too —
 * a broken route from this server is not an outage, and an outage of this
 * server's network is still seen from outside.
 *
 * Configured on the API: PROBE_TOKENS="falkenstein:<token>,ashburn:<token>".
 * Without it there are no probes and outages open as before.
 */

/** A probe's answer counts for this long. */
export const FRESH_MS = 3 * 60 * 1000;
/** Healthy sites are checked from each probe this often. */
const EVERY_MS = 5 * 60 * 1000;
/** Failing ones every minute, like here. */
const FAILING_EVERY_MS = 60 * 1000;

export type Probe = { name: string; token: string };

export function configuredProbes(env = process.env): Probe[] {
  return (env.PROBE_TOKENS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => {
      const i = p.indexOf(":");
      const name = p.slice(0, i).trim();
      const token = p.slice(i + 1).trim();
      return i > 0 && /^[\w-]{1,40}$/.test(name) && token.length >= 16
        ? [{ name, token }]
        : [];
    });
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** The probe a bearer token belongs to, compared in constant time. */
export function probeOfToken(
  token: string | null | undefined,
  probes = configuredProbes()
): string | null {
  if (!token) return null;
  const given = digest(token);
  let hit: string | null = null;
  for (const p of probes)
    if (timingSafeEqual(given, digest(p.token))) hit = p.name;
  return hit;
}

/** Sites this probe should check now. */
export async function targetsFor(
  probe: string,
  now = Date.now()
): Promise<Array<{ id: string; url: string }>> {
  const [sites, seen] = await Promise.all([
    db
      .select({
        id: repositories.id,
        url: repositories.liveUrl,
        failures: repositories.liveFailures,
      })
      .from(repositories)
      .where(isNotNull(repositories.liveUrl))
      .limit(5000),
    db
      .select({ id: probeResults.repositoryId, at: probeResults.checkedAt })
      .from(probeResults)
      .where(eq(probeResults.probe, probe)),
  ]);
  const last = new Map(seen.map((s) => [s.id, s.at.getTime()]));
  return sites
    .filter((s) => {
      if (!s.url) return false;
      const at = last.get(s.id) ?? 0;
      return now - at >= (s.failures > 0 ? FAILING_EVERY_MS : EVERY_MS) - 5000;
    })
    .slice(0, 500)
    .map((s) => ({ id: s.id, url: s.url! }));
}

export type ProbeResult = {
  id: string;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  durationMs: number | null;
};

export async function saveResults(
  probe: string,
  results: ProbeResult[],
  now = new Date()
): Promise<void> {
  for (const r of results) {
    const row = {
      ok: r.ok,
      httpStatus: r.httpStatus,
      error: r.error?.slice(0, 300) ?? null,
      durationMs: r.durationMs,
      checkedAt: now,
    };
    await db
      .insert(probeResults)
      .values({ repositoryId: r.id, probe, ...row })
      .onConflictDoUpdate({
        target: [probeResults.repositoryId, probeResults.probe],
        set: row,
      })
      // A site deleted in the meantime: nothing to record.
      .catch(() => {});
  }
}

export type Confirmation = {
  /**
   * none: no probes configured; down: another location sees it down too;
   * up: other locations reach it; pending: no fresh answer from them yet.
   */
  state: "none" | "down" | "up" | "pending";
  down: string[];
  up: string[];
};

/** What the other locations say about a site, from fresh answers only. */
export function confirm(
  rows: Array<{ probe: string; ok: boolean; checkedAt: Date }>,
  probes: string[],
  now = Date.now()
): Confirmation {
  if (!probes.length) return { state: "none", down: [], up: [] };
  const fresh = rows.filter(
    (r) => probes.includes(r.probe) && now - r.checkedAt.getTime() <= FRESH_MS
  );
  const down = fresh.filter((r) => !r.ok).map((r) => r.probe);
  const up = fresh.filter((r) => r.ok).map((r) => r.probe);
  // One more location seeing it down is enough; if all that answered reach
  // it, the problem is on this side.
  const state = down.length ? "down" : up.length ? "up" : "pending";
  return { state, down, up };
}

export async function confirmation(
  repositoryId: string,
  now = new Date()
): Promise<Confirmation> {
  const probes = configuredProbes().map((p) => p.name);
  if (!probes.length) return { state: "none", down: [], up: [] };
  const rows = await db
    .select({
      probe: probeResults.probe,
      ok: probeResults.ok,
      checkedAt: probeResults.checkedAt,
    })
    .from(probeResults)
    .where(
      and(
        eq(probeResults.repositoryId, repositoryId),
        gte(probeResults.checkedAt, new Date(now.getTime() - FRESH_MS))
      )
    );
  return confirm(rows, probes, now.getTime());
}

/** Every location's latest view of a site, for its page. */
export async function locationsOf(repositoryId: string) {
  return db
    .select({
      probe: probeResults.probe,
      ok: probeResults.ok,
      httpStatus: probeResults.httpStatus,
      error: probeResults.error,
      durationMs: probeResults.durationMs,
      checkedAt: probeResults.checkedAt,
    })
    .from(probeResults)
    .where(eq(probeResults.repositoryId, repositoryId));
}
