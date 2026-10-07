import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db, orgIntegrations, perfRuns, repositories } from "db";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { validateLiveUrl } from "../lib/live-check";
import { notify } from "../lib/notify";

type PerfRow = typeof perfRuns.$inferSelect;
type Strategy = "mobile" | "desktop";
type Trigger = "schedule" | "deploy" | "manual";

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 180 * DAY_MS;

/**
 * The go-live gate for a site: A run that misses
 * one of these is not "slow", it fails the agency's own standard.
 */
export const BUDGET = {
  seo: 100,
  accessibility: 95,
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 300,
  bytes: 3 * 1024 * 1024,
} as const;

export function budgetFailures(r: Partial<PerfRow>): string[] {
  const out: string[] = [];
  if (r.seo != null && r.seo < BUDGET.seo) out.push(`SEO ${r.seo} (< 100)`);
  if (r.accessibility != null && r.accessibility < BUDGET.accessibility)
    out.push(`Accessibility ${r.accessibility} (< 95)`);
  if (r.lcpMs != null && r.lcpMs > BUDGET.lcpMs)
    out.push(`LCP ${(r.lcpMs / 1000).toFixed(1)} s (> 2.5 s)`);
  if (r.cls != null && r.cls > BUDGET.cls)
    out.push(`CLS ${r.cls.toFixed(2)} (> 0.1)`);
  if (r.tbtMs != null && r.tbtMs > BUDGET.tbtMs)
    out.push(`TBT ${r.tbtMs} ms (> 300 ms)`);
  if (r.bytes != null && r.bytes > BUDGET.bytes)
    out.push(`Page weight ${(r.bytes / 1024 / 1024).toFixed(1)} MB (> 3 MB)`);
  return out;
}

/** Worse than the previous run of the same strategy by a margin that matters. */
export function regression(
  prev: Partial<PerfRow> | null,
  now: Partial<PerfRow>
): string | null {
  if (!prev) return null;
  const parts: string[] = [];
  if (
    prev.performance != null &&
    now.performance != null &&
    prev.performance - now.performance >= 10
  )
    parts.push(`performance ${prev.performance} → ${now.performance}`);
  if (
    prev.lcpMs != null &&
    now.lcpMs != null &&
    now.lcpMs - prev.lcpMs >= 500 &&
    now.lcpMs >= prev.lcpMs * 1.3
  )
    parts.push(
      `LCP ${(prev.lcpMs / 1000).toFixed(1)} s → ${(now.lcpMs / 1000).toFixed(1)} s`
    );
  if (
    prev.cls != null &&
    now.cls != null &&
    now.cls > BUDGET.cls &&
    now.cls - prev.cls >= 0.05
  )
    parts.push(`CLS ${prev.cls.toFixed(2)} → ${now.cls.toFixed(2)}`);
  return parts.length ? parts.join(", ") : null;
}

type Psi = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, { numericValue?: number }>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number }>;
  };
  error?: { message?: string };
};

/** The numbers worth keeping from a PageSpeed Insights answer. */
export function parsePsi(d: Psi): Partial<PerfRow> {
  const cat = d.lighthouseResult?.categories ?? {};
  const audit = (k: string) => d.lighthouseResult?.audits?.[k]?.numericValue;
  const score = (k: string) => {
    const s = cat[k]?.score;
    return s == null ? null : Math.round(s * 100);
  };
  const round = (n: number | undefined) => (n == null ? null : Math.round(n));
  const field = d.loadingExperience?.metrics ?? {};
  const cls = field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
  return {
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    seo: score("seo"),
    lcpMs: round(audit("largest-contentful-paint")),
    cls: audit("cumulative-layout-shift") ?? null,
    tbtMs: round(audit("total-blocking-time")),
    fcpMs: round(audit("first-contentful-paint")),
    ttfbMs: round(audit("server-response-time")),
    bytes: round(audit("total-byte-weight")),
    fieldLcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    fieldInpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    // Google reports CLS ×100 in field data.
    fieldCls: cls == null ? null : cls / 100,
  };
}

async function apiKey(organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ key: orgIntegrations.pagespeedApiKey })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId));
  if (!row?.key) return process.env.PAGESPEED_API_KEY?.trim() || null;
  try {
    return isEncrypted(row.key) ? decryptSecret(row.key) : row.key;
  } catch {
    return null;
  }
}

/** The page visitors get, not the health endpoint the live URL may point at. */
export function pageToTest(liveUrl: string): string | null {
  try {
    const u = new URL(liveUrl);
    return /\/api\//.test(u.pathname) ? `${u.origin}/` : u.toString();
  } catch {
    return null;
  }
}

async function runOne(
  url: string,
  strategy: Strategy,
  key: string
): Promise<
  { ok: true; data: Partial<PerfRow> } | { ok: false; error: string }
> {
  const q = new URLSearchParams({ url, strategy, key });
  for (const c of ["performance", "accessibility", "best-practices", "seo"])
    q.append("category", c);
  try {
    const res = await fetch(`${PSI}?${q}`, {
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => ({}))) as Psi;
    if (!res.ok || body.error)
      return {
        ok: false,
        error: `PageSpeed Insights: ${body.error?.message?.slice(0, 200) ?? `HTTP ${res.status}`}`,
      };
    return { ok: true, data: parsePsi(body) };
  } catch (e) {
    return {
      ok: false,
      error: `PageSpeed Insights did not answer (${e instanceof Error ? e.message : "network error"})`,
    };
  }
}

/**
 * Lighthouse for a repository's live site, mobile and desktop. Notifies when
 * a run is clearly worse than the one before — after a deploy that names
 * the commit that did it.
 */
export async function runPerf(
  repositoryId: string,
  opts: { trigger: Trigger; strategies?: Strategy[] }
): Promise<{ ok: boolean; runs: PerfRow[]; error?: string }> {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  if (!repo?.liveUrl) return { ok: false, runs: [], error: "No live URL set." };
  const url = pageToTest(repo.liveUrl);
  if (!url || !validateLiveUrl(url).ok)
    return { ok: false, runs: [], error: "The live URL cannot be tested." };
  const key = await apiKey(repo.organizationId);
  if (!key)
    return {
      ok: false,
      runs: [],
      error:
        "No PageSpeed Insights API key — add one under Settings → Performance (free).",
    };
  const runs: PerfRow[] = [];
  for (const strategy of opts.strategies ?? (["mobile", "desktop"] as const)) {
    const [prev] = await db
      .select()
      .from(perfRuns)
      .where(
        and(
          eq(perfRuns.repositoryId, repo.id),
          eq(perfRuns.strategy, strategy),
          isNull(perfRuns.error)
        )
      )
      .orderBy(desc(perfRuns.createdAt))
      .limit(1);
    const res = await runOne(url, strategy, key);
    const [row] = await db
      .insert(perfRuns)
      .values({
        repositoryId: repo.id,
        url,
        strategy,
        trigger: opts.trigger,
        commit: repo.liveCommit,
        ...(res.ok ? res.data : { error: res.error }),
      })
      .returning();
    if (row) runs.push(row);
    if (!res.ok || !row) continue;
    const worse = regression(prev ?? null, row);
    if (worse) {
      await notify(repo.organizationId, {
        type: "workflow_failed",
        title: `${repo.name} got slower (${strategy}): ${worse}`,
        message: `${opts.trigger === "deploy" ? `After the deploy${repo.liveCommit ? ` of ${repo.liveCommit.slice(0, 7)}` : ""}. ` : ""}Lighthouse ${strategy} on ${url}.${budgetFailures(row).length ? ` Misses the budget: ${budgetFailures(row).join(", ")}.` : ""}`,
        url,
      }).catch(() => {});
    }
  }
  return {
    ok: runs.some((r) => !r.error),
    runs,
    error: runs.find((r) => r.error)?.error ?? undefined,
  };
}

/** Every live site once a day, and old runs pruned. */
export async function runDuePerf(): Promise<void> {
  const repos = await db
    .select({
      id: repositories.id,
      organizationId: repositories.organizationId,
    })
    .from(repositories)
    .where(isNotNull(repositories.liveUrl));
  const keyed = new Map<string, boolean>();
  for (const r of repos) {
    if (!keyed.has(r.organizationId))
      keyed.set(r.organizationId, !!(await apiKey(r.organizationId)));
    if (!keyed.get(r.organizationId)) continue;
    const [last] = await db
      .select({ createdAt: perfRuns.createdAt })
      .from(perfRuns)
      .where(eq(perfRuns.repositoryId, r.id))
      .orderBy(desc(perfRuns.createdAt))
      .limit(1);
    if (last && Date.now() - last.createdAt.getTime() < DAY_MS) continue;
    await runPerf(r.id, { trigger: "schedule" }).catch((e) =>
      console.error("[perf] run failed:", e)
    );
  }
  await db
    .delete(perfRuns)
    .where(lt(perfRuns.createdAt, new Date(Date.now() - RETENTION_MS)));
}
