import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  orgIntegrations,
  serverMetrics,
  containerMetrics,
  storageMetrics,
  serverScanRuns,
  servers,
  updateRuns,
} from "db";
import { syncAndNotify } from "../lib/server-findings";
import { isDue, isValidSchedule } from "./scheduler";
import { startNucleiRun } from "./nuclei";
import { syncKumaForOrg } from "./kuma";
import { syncWazuhForOrg } from "./wazuh";
import { runDueNetworkChecks } from "./network-check";
import { sendDueDigests } from "./digest";
import { syncDueHetzner } from "./hetzner";
import { syncDueDokploy } from "./dokploy-sync";
import { checkDueDokployRisks } from "./dokploy-risk";
import { checkDueImages } from "./image-freshness";
import { pruneLogErrors } from "./log-errors";
import { syncDueCoolify } from "./coolify";
import { syncDueStacks } from "./stack-platforms";
import { watchDuePlatforms } from "./platform-watch";
import { checkDueUnmanaged } from "./unmanaged";
import { closeInterruptedWatches, reconcileFailedDeploys } from "./live-sweep";
import { runDueSiteProbes } from "./site-probe";
import { runDuePerf } from "./perf";
import { runChangeWatch } from "./change-watch";
import { runDueDomainChecks } from "./domain-check";
import { CONTAINER_METRICS_RETENTION_MS } from "./workload-usage";
import { runDueChecks } from "./synthetic";

/**
 * The agent reports every 5 minutes. Three missed reports is not a network
 * blip any more: the agent, the timer or the whole server is gone — and a
 * silent server is exactly the one nobody notices.
 */
export const STALE_AFTER_MS = 20 * 60 * 1000;
const METRICS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
// Hourly, a few rows per server: months of growth stay cheap.
const STORAGE_METRICS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** A Nuclei run left running this long lost its process. */
const STALE_RUN_MS = 2 * 60 * 60 * 1000;

let lastPruneAt = 0;
let running = false;

/** Mark servers whose agent went quiet (or never started). */
async function checkHeartbeats(): Promise<void> {
  const now = Date.now();
  const rows = await db
    .select()
    .from(servers)
    .where(isNotNull(servers.agentTokenHash));
  for (const s of rows) {
    const since = s.lastReportAt ?? s.agentTokenCreatedAt;
    if (!since || now - since.getTime() < STALE_AFTER_MS) continue;
    // A server checked only from the outside is a valid setup on its own.
    if (!s.lastReportAt && s.address) continue;
    await syncAndNotify(s.id, "heartbeat", [
      s.lastReportAt
        ? {
            fingerprint: "stale",
            severity: "high",
            title: "Agent stopped reporting",
            detail: `Last report ${s.lastReportAt.toISOString()}. Load, updates, CrowdSec and Trivy data for this server are out of date — the server, the agent or its timer may be down.`,
          }
        : {
            fingerprint: "never",
            severity: "medium",
            title: "Agent has never reported",
            detail:
              "A token was issued but no report arrived. Run the install command on the server, then check `systemctl status pc-agent-metrics.timer`.",
          },
    ]);
  }
}

async function runDueNucleiScans(): Promise<void> {
  const rows = await db
    .select()
    .from(servers)
    .where(isNotNull(servers.nucleiSchedule));
  for (const s of rows) {
    const schedule = s.nucleiSchedule?.trim();
    if (!schedule || !isValidSchedule(schedule)) continue;
    const [last] = await db
      .select({
        status: serverScanRuns.status,
        startedAt: serverScanRuns.startedAt,
      })
      .from(serverScanRuns)
      .where(eq(serverScanRuns.serverId, s.id))
      .orderBy(desc(serverScanRuns.startedAt))
      .limit(1);
    if (last && (last.status === "pending" || last.status === "running"))
      continue;
    if (!isDue(schedule, last?.startedAt ?? null)) continue;
    console.log(`[servers] Scheduled Nuclei scan for ${s.name} (${s.id})`);
    await startNucleiRun(s.id);
  }
}

/**
 * Fix and update runs live in this process. A restart (a deploy of Package
 * Checker) ends them mid-way and leaves them "updating" forever — which also
 * blocks the next fix for that repository. An hour is far beyond any run.
 */
async function failStaleUpdateRuns(): Promise<void> {
  await db
    .update(updateRuns)
    .set({
      status: "failed",
      currentStep: null,
      logOutput: sql`coalesce(${updateRuns.logOutput}, '') || ${"\n\nStopped: the run stopped making progress (Moatline restarted or the process died). Start it again."}`,
    })
    .where(
      and(
        inArray(updateRuns.status, [
          "created",
          "updating",
          "build_running",
          "deploying",
        ]),
        or(
          // Heartbeat stopped: the process working on it is gone.
          lt(updateRuns.heartbeatAt, new Date(Date.now() - 10 * 60 * 1000)),
          and(
            isNull(updateRuns.heartbeatAt),
            lt(updateRuns.triggeredAt, new Date(Date.now() - 60 * 60 * 1000))
          )
        )
      )
    );
}

async function failStaleRuns(): Promise<void> {
  await db
    .update(serverScanRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      errorMessage: "Run did not finish – the API was restarted.",
    })
    .where(
      and(
        eq(serverScanRuns.status, "running"),
        lt(serverScanRuns.startedAt, new Date(Date.now() - STALE_RUN_MS))
      )
    );
}

/** Once a day: paid quantities against the number of servers. */
async function pruneMetrics(): Promise<void> {
  if (Date.now() - lastPruneAt < 60 * 60 * 1000) return;
  lastPruneAt = Date.now();
  await db
    .delete(serverMetrics)
    .where(
      lt(serverMetrics.recordedAt, new Date(Date.now() - METRICS_RETENTION_MS))
    );
  await db
    .delete(containerMetrics)
    .where(
      lt(
        containerMetrics.recordedAt,
        new Date(Date.now() - CONTAINER_METRICS_RETENTION_MS)
      )
    );
  await db
    .delete(storageMetrics)
    .where(
      lt(
        storageMetrics.recordedAt,
        new Date(Date.now() - STORAGE_METRICS_RETENTION_MS)
      )
    );
  await pruneLogErrors();
}

async function pullIntegrations(): Promise<void> {
  const orgs = await db
    .select({
      organizationId: orgIntegrations.organizationId,
      kuma: orgIntegrations.kumaBaseUrl,
      wazuh: orgIntegrations.wazuhApiUrl,
    })
    .from(orgIntegrations);
  for (const o of orgs) {
    if (o.kuma) {
      await syncKumaForOrg(o.organizationId).catch((e) =>
        console.error("[servers] Kuma sync failed:", e)
      );
    }
    if (o.wazuh) {
      await syncWazuhForOrg(o.organizationId).catch((e) =>
        console.error("[servers] Wazuh sync failed:", e)
      );
    }
  }
}

/**
 * One pass of server monitoring, run on the scheduler's tick. Each step is
 * isolated: Kuma being unreachable must not stop the heartbeat check.
 */
export async function runServerTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const steps: Array<[string, () => Promise<void>]> = [
      ["heartbeats", checkHeartbeats],
      ["stale runs", failStaleRuns],
      ["stale fix runs", failStaleUpdateRuns],
      ["integrations", pullIntegrations],
      ["hetzner", syncDueHetzner],
      ["dokploy", syncDueDokploy],
      ["dokploy risks", checkDueDokployRisks],
      ["images", checkDueImages],
      ["coolify", syncDueCoolify],
      ["komodo and portainer", syncDueStacks],
      ["platform versions", watchDuePlatforms],
      ["unmanaged", checkDueUnmanaged],
      ["synthetic checks", () => runDueChecks()],
      ["changes", runChangeWatch],
      ["deploy watches", closeInterruptedWatches],
      ["failed deploys", reconcileFailedDeploys],
      ["site probes", runDueSiteProbes],
      ["performance", runDuePerf],
      ["domains", runDueDomainChecks],
      ["network", runDueNetworkChecks],
      ["nuclei", runDueNucleiScans],
      ["prune", pruneMetrics],
      ["digest", () => sendDueDigests()],
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (e) {
        console.error(`[servers] ${name} failed:`, e);
      }
    }
  } finally {
    running = false;
  }
}
