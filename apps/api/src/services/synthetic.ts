import { and, eq, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import { db, incidents, repositories, syntheticChecks } from "db";
import { decryptSecret, encryptSecret, isEncrypted } from "../lib/crypto";
import { emitEvent } from "../lib/events";
import { notify } from "../lib/notify";
import { runJourney, type JourneyResult, type Step } from "../lib/synthetic";

/** Failures in a row before a journey becomes an incident. */
export const FAILURES_TO_OPEN = 2;

export function sealSecrets(
  vars: Record<string, string> | null
): string | null {
  if (!vars || !Object.keys(vars).length) return null;
  return encryptSecret(JSON.stringify(vars));
}

function openSecrets(sealed: string | null): Record<string, string> {
  if (!sealed) return {};
  try {
    const json = isEncrypted(sealed) ? decryptSecret(sealed) : sealed;
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

type Step_ = { at: string; text: string };

/** Run one journey now; record it; open or close its incident. */
export async function runCheck(
  checkId: string,
  now = new Date()
): Promise<JourneyResult | null> {
  const [row] = await db
    .select({ check: syntheticChecks, repo: repositories })
    .from(syntheticChecks)
    .innerJoin(repositories, eq(repositories.id, syntheticChecks.repositoryId))
    .where(eq(syntheticChecks.id, checkId));
  if (!row) return null;
  const { check, repo } = row;
  if (!repo.liveUrl) return null;
  const origin = new URL(repo.liveUrl).origin;
  const result = await runJourney(
    origin,
    check.steps as Step[],
    openSecrets(check.secrets)
  );
  const failures = result.ok ? 0 : check.failures + 1;
  await db
    .update(syntheticChecks)
    .set({
      lastRunAt: now,
      lastOk: result.ok,
      lastResult: result.steps,
      failures,
    })
    .where(eq(syntheticChecks.id, check.id));

  const [open] = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.repositoryId, repo.id),
        eq(incidents.kind, "check"),
        eq(incidents.externalId, check.id),
        isNull(incidents.resolvedAt)
      )
    );
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  const url = appUrl ? `${appUrl}/repos/${repo.id}` : repo.liveUrl;
  const failed = result.steps.find((s) => !s.ok);
  if (!result.ok && failures >= FAILURES_TO_OPEN && !open) {
    const what = `“${check.name}” fails at ${failed?.step}: ${failed?.error}`;
    await db.insert(incidents).values({
      organizationId: repo.organizationId,
      repositoryId: repo.id,
      kind: "check",
      externalId: check.id,
      startedAt: now,
      cause: what,
      timeline: [{ at: now.toISOString(), text: `Check failed: ${what}` }],
    });
    emitEvent(repo.organizationId, {
      name: "check.failed",
      title: `${repo.name}: check ${what}`,
      severity: "error",
      repository: repo,
      attributes: { "check.name": check.name, "check.step": failed?.step },
    });
    await notify(repo.organizationId, {
      type: "server_alert",
      title: `${repo.name}: check “${check.name}” fails`,
      message: `${failed?.step}: ${failed?.error}`,
      url,
    }).catch(() => {});
  } else if (result.ok && open) {
    await db
      .update(incidents)
      .set({
        resolvedAt: now,
        timeline: [
          ...((open.timeline as Step_[]) ?? []),
          { at: now.toISOString(), text: "Check passes again" },
        ],
      })
      .where(eq(incidents.id, open.id));
    emitEvent(repo.organizationId, {
      name: "check.recovered",
      title: `${repo.name}: check “${check.name}” passes again`,
      severity: "info",
      repository: repo,
    });
    await notify(repo.organizationId, {
      type: "server_alert",
      title: `${repo.name}: check “${check.name}” passes again`,
      message: "All steps passed.",
      url,
    }).catch(() => {});
  }
  return result;
}

/** Every journey that is due, a few at a time. */
export async function runDueChecks(now = Date.now()): Promise<void> {
  const rows = await db
    .select({
      id: syntheticChecks.id,
      lastRunAt: syntheticChecks.lastRunAt,
      intervalMinutes: syntheticChecks.intervalMinutes,
    })
    .from(syntheticChecks)
    .where(eq(syntheticChecks.enabled, true));
  const due = rows.filter(
    (r) =>
      !r.lastRunAt ||
      now - r.lastRunAt.getTime() >= r.intervalMinutes * 60_000 - 15_000
  );
  const limit = pLimit(4);
  await Promise.all(
    due.map((r) =>
      limit(() =>
        runCheck(r.id).catch((e) => console.error("[checks] run failed:", e))
      )
    )
  );
}
