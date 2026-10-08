import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import {
  db,
  repositories,
  scans,
  updateRuns,
  deployRuns,
  servers,
  serverFindings,
  vulnerabilities,
  packageFindings,
  perfRuns,
  clients,
  syntheticChecks,
  orgIntegrations,
} from "db";
import { resolveAutomationPolicy } from "../lib/automation-policy";
import semver from "semver";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization, requireSession } from "../middleware/tenant";
import { runScan } from "../services/scan";
import { runUpdateWorkflow } from "../services/update-workflow";
import { runSecurityFix } from "../services/security-fix";
import { deployRepository, resolveDokployConfig } from "../services/deploy";
import { runLiveCheck } from "../services/live-check";
import { startLiveScan } from "../services/live-scan";
import { validateLiveUrl } from "../lib/live-check";
import { fetchApplicationDomains } from "../lib/dokploy";
import {
  loadGitHosts,
  parseRepoUrl,
  resolveRepo,
  webUrl,
} from "../lib/git-host";
import {
  branchOverview,
  deletable,
  type BranchRow,
} from "../services/branch-overview";
import { nextRunAt } from "../services/scheduler";
import { audit } from "../lib/audit-log";
import { syncDokployForOrg } from "../services/dokploy-sync";
import { syncCoolifyForOrg } from "../services/coolify";
import { gitStacks, syncStacksForOrg } from "../services/stack-platforms";
import { configuredProbes, locationsOf } from "../services/probes";
import { checkMigrations } from "../services/migration-guard";
import {
  dokployImportPlan,
  importFromDokploy,
} from "../services/dokploy-import";
import { startBulkUpgrade, versionOverview } from "../services/versions";
import { errorSummary } from "../services/log-errors";
import { runCheck, sealSecrets } from "../services/synthetic";
import { PRESETS } from "../lib/synthetic";
import { openIncidents, repoIncidents } from "../services/incidents";
import { mergeAndDeploy } from "../services/merge-deploy";
import { rollbackDeploy } from "../services/deploy-guard";
import { reconcileFailedDeploys } from "../services/live-sweep";
import { alignRunBranch } from "../services/align-run";
import { buildFindingsReport } from "../services/findings-report";
import { probeSite } from "../services/site-probe";
import { budgetFailures, runPerf } from "../services/perf";
import pLimit from "p-limit";
import {
  hasDeployTarget,
  platform,
  repoTarget as appTarget,
} from "../services/platforms";
import { blockedBy } from "../services/billing";

/** "Scan all": light scans, but still not all at once. */
const fastScans = pLimit(3);

const stepSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "HEAD"]),
  path: z
    .string()
    .regex(/^\/(?!\/)\S{0,500}$/, "A path on the site, starting with /"),
  body: z.string().max(4000).optional(),
  contentType: z.enum(["json", "form", "none"]).optional(),
  expectStatus: z.number().int().min(100).max(599).optional(),
  expectText: z.string().max(200).optional(),
  maxMs: z.number().int().min(100).max(30000).optional(),
});
const checkSchema = z.object({
  name: z.string().trim().min(1).max(80),
  steps: z.array(stepSchema).min(1).max(10),
  // Replaces the stored ones when given; null clears; absent keeps.
  secrets: z
    .record(
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,40}$/),
      z.string().max(500)
    )
    .nullable()
    .optional(),
  intervalMinutes: z.number().int().min(5).max(1440).optional(),
  enabled: z.boolean().optional(),
});

const repoTarget = (r: { id: string; name: string }) => ({
  type: "repository",
  id: r.id,
  name: r.name,
});

/**
 * When the scheduler will next pick this repo up. Based on the last *attempt*
 * (success or failure), which is what the scheduler itself uses — otherwise a
 * repo whose scans fail would permanently read as "overdue".
 */
/** A repository of this organization, or null. */
async function ownRepo(orgId: string, id: string) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(
      and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
    );
  return repo ?? null;
}

function nextScanAtFor(
  schedule: string | null,
  lastScannedAt: Date | null,
  lastAttemptAt: Date | null
): string | null {
  if (!schedule?.trim()) return null;
  const times = [lastScannedAt, lastAttemptAt].filter(
    (d): d is Date => d instanceof Date
  );
  const lastRunAt = times.length
    ? new Date(Math.max(...times.map((d) => d.getTime())))
    : null;
  return nextRunAt(schedule, lastRunAt)?.toISOString() ?? null;
}

/** Branch overviews for a few minutes: each costs up to a hundred API calls. */
const branchCache = new Map<
  string,
  { at: number; data: { branches: BranchRow[]; truncated: boolean } }
>();
const BRANCH_CACHE_MS = 5 * 60 * 1000;

const deleteBranchesSchema = z.object({
  names: z.array(z.string().min(1).max(255)).min(1).max(200),
});

const createRepoSchema = z.object({
  // Any supported host, despite the name: GitHub, GitLab, Bitbucket,
  // Gitea/Forgejo — the column predates the others.
  githubUrl: z.string().min(1).max(500),
  name: z.string().min(1).optional(),
  defaultBranch: z.string().optional(),
  packageJsonPath: z.string().optional(),
});

const updateRepoSchema = z.object({
  defaultBranch: z.string().min(1).optional(),
  packageJsonPath: z.string().optional(),
  autoFixCritical: z.boolean().optional(),
  autoFixForce: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
  autoDeploy: z.boolean().optional(),
  autoRollback: z.boolean().optional(),
  autoHeal: z.boolean().optional(),
  dokployApplicationId: z.string().nullable().optional(),
  coolifyAppUuid: z.string().max(100).nullable().optional(),
  /** A Komodo or Portainer stack; null unlinks. */
  platformApp: z
    .object({
      kind: z.enum(["komodo", "portainer"]),
      id: z.string().min(1).max(200),
    })
    .nullable()
    .optional(),
  liveUrl: z.string().nullable().optional(),
  scanSchedule: z.string().nullable().optional(),
  packageManager: z.enum(["npm", "pnpm", "yarn"]).nullable().optional(),
  verifyMode: z.enum(["typecheck", "build", "none"]).optional(),
  serverId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
});

export const reposRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const list = await db
      .select()
      .from(repositories)
      .where(eq(repositories.organizationId, orgId));
    if (list.length === 0) return c.json([]);

    // Latest scan per repo (any outcome), so the list can show both the state
    // of the last run and when automation will fire next.
    const recent = await db
      .select({
        repositoryId: scans.repositoryId,
        status: scans.status,
        startedAt: scans.startedAt,
      })
      .from(scans)
      .where(
        inArray(
          scans.repositoryId,
          list.map((r) => r.id)
        )
      )
      .orderBy(desc(scans.startedAt));
    const latestByRepo = new Map<string, (typeof recent)[number]>();
    for (const s of recent) {
      if (!latestByRepo.has(s.repositoryId))
        latestByRepo.set(s.repositoryId, s);
    }

    // What the list shows at a glance: CVEs and outdated packages from the
    // latest successful scan, the last deploy, and the newest update run.
    const ids = list.map((r) => r.id);
    const successful = await db
      .select({ id: scans.id, repositoryId: scans.repositoryId })
      .from(scans)
      .where(and(inArray(scans.repositoryId, ids), eq(scans.status, "success")))
      .orderBy(desc(scans.startedAt));
    const scanOf = new Map<string, string>();
    for (const sc of successful)
      if (!scanOf.has(sc.repositoryId)) scanOf.set(sc.repositoryId, sc.id);
    const scanIds = [...scanOf.values()];
    const vulnRows = scanIds.length
      ? await db
          .select({
            scanId: vulnerabilities.scanId,
            severity: vulnerabilities.severity,
            fixAvailable: vulnerabilities.fixAvailable,
          })
          .from(vulnerabilities)
          .where(inArray(vulnerabilities.scanId, scanIds))
      : [];
    const pkgRows = scanIds.length
      ? await db
          .select({
            scanId: packageFindings.scanId,
            current: packageFindings.currentVersion,
            latest: packageFindings.latestVersion,
          })
          .from(packageFindings)
          .where(inArray(packageFindings.scanId, scanIds))
      : [];
    const deploys = await db
      .select({
        repositoryId: deployRuns.repositoryId,
        status: deployRuns.status,
        guard: deployRuns.guard,
        liveOk: deployRuns.liveOk,
        triggeredAt: deployRuns.triggeredAt,
      })
      .from(deployRuns)
      .where(inArray(deployRuns.repositoryId, ids))
      .orderBy(desc(deployRuns.triggeredAt));
    const runs = await db
      .select({
        id: updateRuns.id,
        repositoryId: updateRuns.repositoryId,
        kind: updateRuns.kind,
        status: updateRuns.status,
        prUrl: updateRuns.prUrl,
        buildOk: updateRuns.buildOk,
        merged: updateRuns.merged,
        triggeredAt: updateRuns.triggeredAt,
      })
      .from(updateRuns)
      .where(inArray(updateRuns.repositoryId, ids))
      .orderBy(desc(updateRuns.triggeredAt));
    const perfRows = await db
      .select({
        repositoryId: perfRuns.repositoryId,
        performance: perfRuns.performance,
        lcpMs: perfRuns.lcpMs,
        cls: perfRuns.cls,
        tbtMs: perfRuns.tbtMs,
        seo: perfRuns.seo,
        accessibility: perfRuns.accessibility,
        bytes: perfRuns.bytes,
      })
      .from(perfRuns)
      .where(
        and(
          inArray(perfRuns.repositoryId, ids),
          eq(perfRuns.strategy, "mobile"),
          isNull(perfRuns.error)
        )
      )
      .orderBy(desc(perfRuns.createdAt))
      .limit(500);
    const summary = (repoId: string) => {
      const scanId = scanOf.get(repoId);
      const vulns = { critical: 0, high: 0, moderate: 0, low: 0, fixable: 0 };
      for (const v of vulnRows) {
        if (v.scanId !== scanId) continue;
        if (v.severity in vulns) vulns[v.severity as keyof typeof vulns]++;
        if (v.fixAvailable) vulns.fixable++;
      }
      let outdated = 0;
      let major = 0;
      for (const p of pkgRows) {
        if (p.scanId !== scanId) continue;
        const cur = semver.coerce(p.current);
        const lat = semver.coerce(p.latest);
        if (!cur || !lat || !semver.lt(cur, lat)) continue;
        outdated++;
        if (lat.major > cur.major) major++;
      }
      const deploy = deploys.find((d) => d.repositoryId === repoId) ?? null;
      const perfRow = perfRows.find((p) => p.repositoryId === repoId);
      return {
        perf: perfRow
          ? {
              performance: perfRow.performance,
              lcpMs: perfRow.lcpMs,
              failures: budgetFailures(perfRow).length,
            }
          : null,
        vulns: scanId ? vulns : null,
        outdated: scanId ? { total: outdated, major } : null,
        lastDeploy: deploy,
        // A run that still asks for something: one in progress, else the
        // newest whose PR is open — not just the newest run, which may be a
        // failed one sitting on top of an open PR.
        openRun:
          runs.find(
            (u) =>
              u.repositoryId === repoId &&
              ["created", "updating", "build_running", "deploying"].includes(
                u.status
              )
          ) ??
          runs.find(
            (u) =>
              u.repositoryId === repoId && u.status === "pr_opened" && !u.merged
          ) ??
          null,
      };
    };

    const hosts = await loadGitHosts(orgId);
    return c.json(
      list.map((r) => {
        const last = latestByRepo.get(r.id);
        return {
          ...r,
          gitHost: parseRepoUrl(r.githubUrl, hosts)?.kind ?? null,
          ...summary(r.id),
          lastScanStatus: last?.status ?? null,
          nextScanAt: nextScanAtFor(
            r.scanSchedule,
            r.lastScannedAt,
            last?.startedAt ?? null
          ),
        };
      })
    );
  })
  // The organization's Dokploy applications, for picking the one a
  // repository deploys to. Also links every repository with an obvious
  // match (same GitHub repository and branch) right away.
  // Coolify's applications, for linking a repository by hand.
  .get("/coolify-apps", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const res = await syncCoolifyForOrg(orgId);
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json({
      apps: res.resources
        .filter((r) => r.kind === "application")
        .map((r) => ({
          uuid: r.uuid,
          name: r.name,
          githubRepo: r.githubRepo,
          branch: r.branch,
          url: r.url,
        })),
      linked: res.linked,
    });
  })
  // Komodo and Portainer stacks that deploy from Git, for linking a
  // repository by hand. Links every obvious match right away.
  .get("/stack-apps", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const { linked } = await syncStacksForOrg(orgId);
    const stacks = await gitStacks(orgId);
    return c.json({ apps: stacks, linked });
  })
  .get("/dokploy-apps", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const res = await syncDokployForOrg(orgId);
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json({
      apps: res.apps,
      linked: res.linked,
      projects: res.projects,
    });
  })
  // Sites down right now.
  .get("/incidents/open", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(await openIncidents(orgId));
  })
  // Payload / Next.js / React / Node across all repositories.
  .get("/versions", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(await versionOverview(orgId));
  })
  // Bulk upgrade: one family to one release, a pull request per repository.
  .post(
    "/bulk-upgrade",
    zValidator(
      "json",
      z.object({
        family: z.enum(["Payload", "Next.js"]),
        version: z
          .string()
          .regex(
            /^\d+\.\d+\.\d+(-[\w.]+)?$/,
            "Use an exact version, e.g. 3.58.0"
          ),
        repoIds: z.array(z.string().uuid()).min(1).max(200),
      })
    ),
    async (c) => {
      const orgId = requireOrganization(c);
      if (orgId instanceof Response) return orgId;
      const { family, version, repoIds } = c.req.valid("json");
      const res = await startBulkUpgrade(orgId, { family, version }, repoIds);
      if (!res.ok) return c.json({ error: res.error }, res.status);
      await audit(
        c,
        "repo.bulk_upgrade",
        { type: "repositories" },
        { family, version, repos: res.started }
      );
      return c.json(res, 202);
    }
  )
  // "Add everything from Dokploy": what is deployed there but not here yet.
  .get("/dokploy-import", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const res = await dokployImportPlan(orgId);
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json(res.plan);
  })
  .post(
    "/dokploy-import",
    zValidator(
      "json",
      z.object({ applicationIds: z.array(z.string().min(1)).min(1).max(500) })
    ),
    async (c) => {
      const orgId = requireOrganization(c);
      if (orgId instanceof Response) return orgId;
      const blocked = await blockedBy(orgId, "repository");
      if (blocked) return c.json({ error: blocked }, 402);
      const res = await importFromDokploy(
        orgId,
        c.req.valid("json").applicationIds
      );
      if (!res.ok) return c.json({ error: res.error }, 400);
      // A fast scan each, so the new repositories show their state at once.
      for (const repo of res.created) {
        await audit(c, "repo.create", repoTarget(repo), { from: "dokploy" });
        const [scan] = await db
          .insert(scans)
          .values({ repositoryId: repo.id, status: "pending" })
          .returning({ id: scans.id });
        if (scan)
          fastScans(() => runScan(repo.id, scan.id)).catch((err) =>
            console.error("[api] fast scan error:", err)
          );
      }
      return c.json({ created: res.created.length }, 201);
    }
  )
  // A fast scan of every repository: lockfile + advisory database, no clone
  // (see runScan). A few at a time; repositories already scanning are left.
  .post("/scan-all", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const list = await db
      .select({ id: repositories.id, name: repositories.name })
      .from(repositories)
      .where(eq(repositories.organizationId, orgId));
    const busy = list.length
      ? await db
          .select({ repositoryId: scans.repositoryId })
          .from(scans)
          .where(
            and(
              inArray(
                scans.repositoryId,
                list.map((r) => r.id)
              ),
              inArray(scans.status, ["pending", "running"])
            )
          )
      : [];
    const skip = new Set(busy.map((b) => b.repositoryId));
    let started = 0;
    for (const repo of list) {
      if (skip.has(repo.id)) continue;
      const [scan] = await db
        .insert(scans)
        .values({ repositoryId: repo.id, status: "pending" })
        .returning({ id: scans.id });
      if (!scan) continue;
      started++;
      fastScans(() => runScan(repo.id, scan.id)).catch((err) =>
        console.error("[api] fast scan error:", err)
      );
    }
    await audit(c, "repo.scan_all", { type: "repositories" }, { started });
    return c.json({ started, skipped: skip.size }, 202);
  })
  .post("/", zValidator("json", createRepoSchema), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const blocked = await blockedBy(orgId, "repository");
    if (blocked) return c.json({ error: blocked }, 402);
    const body = c.req.valid("json");
    const ref = parseRepoUrl(body.githubUrl, await loadGitHosts(orgId));
    if (!ref)
      return c.json(
        {
          error:
            "Not a repository URL on GitHub, GitLab, Bitbucket, Codeberg or a Git host added under Settings.",
        },
        400
      );
    const name = body.name ?? ref.repo;
    const defaultBranch = body.defaultBranch?.trim() || ref.branch;
    const packageJsonPath =
      body.packageJsonPath?.trim() && body.packageJsonPath !== "package.json"
        ? body.packageJsonPath.endsWith("package.json")
          ? body.packageJsonPath
          : `${body.packageJsonPath.replace(/\/+$/, "")}/package.json`
        : "package.json";
    const [integ] = await db
      .select({ automationPolicy: orgIntegrations.automationPolicy })
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId));
    const policy = resolveAutomationPolicy(integ?.automationPolicy);
    const [repo] = await db
      .insert(repositories)
      .values({
        organizationId: orgId,
        githubUrl: webUrl(ref),
        name,
        defaultBranch,
        packageJsonPath,
        autoFixCritical: policy.defaultAutoFixCritical,
      })
      .returning();
    await audit(c, "repo.create", repoTarget(repo!));
    return c.json(repo!, 201);
  })
  .get("/:id", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const [last] = await db
      .select({ startedAt: scans.startedAt })
      .from(scans)
      .where(eq(scans.repositoryId, repo.id))
      .orderBy(desc(scans.startedAt))
      .limit(1);
    return c.json({
      ...repo,
      gitHost:
        parseRepoUrl(repo.githubUrl, await loadGitHosts(orgId))?.kind ?? null,
      nextScanAt: nextScanAtFor(
        repo.scanSchedule,
        repo.lastScannedAt,
        last?.startedAt ?? null
      ),
    });
  })
  .put("/:id", zValidator("json", updateRepoSchema), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!existing) return c.json({ error: "Repository not found" }, 404);
    const body = c.req.valid("json");
    const updates: Partial<typeof repositories.$inferInsert> = {};
    if (body.defaultBranch !== undefined)
      updates.defaultBranch = body.defaultBranch;
    if (body.packageJsonPath !== undefined) {
      updates.packageJsonPath =
        !body.packageJsonPath?.trim() || body.packageJsonPath === "package.json"
          ? "package.json"
          : body.packageJsonPath.endsWith("package.json")
            ? body.packageJsonPath
            : `${body.packageJsonPath.replace(/\/+$/, "")}/package.json`;
    }
    for (const key of [
      "autoFixCritical",
      "autoFixForce",
      "autoMerge",
      "autoDeploy",
      "autoRollback",
      "autoHeal",
    ] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (body.coolifyAppUuid !== undefined)
      updates.coolifyAppUuid = body.coolifyAppUuid?.trim() || null;
    if (body.platformApp !== undefined) {
      updates.platformKind = body.platformApp?.kind ?? null;
      updates.platformAppId = body.platformApp?.id.trim() ?? null;
    }
    if (body.dokployApplicationId !== undefined) {
      updates.dokployApplicationId = body.dokployApplicationId?.trim() || null;
      // The service name follows the application on the next sync.
      if (updates.dokployApplicationId !== existing.dokployApplicationId)
        updates.dokployAppName = null;
    }
    if (body.liveUrl !== undefined) {
      const url = body.liveUrl?.trim() || null;
      if (url) {
        const valid = validateLiveUrl(url);
        if (!valid.ok) return c.json({ error: valid.reason }, 400);
      }
      updates.liveUrl = url;
      // A different address says nothing about the new one yet – drop the old
      // verdict rather than showing it against a URL it never described.
      if (url !== existing.liveUrl) {
        updates.liveStatus = null;
        updates.liveHttpStatus = null;
        updates.liveCommit = null;
        updates.liveError = null;
        updates.liveCheckedAt = null;
      }
    }
    if (body.scanSchedule !== undefined)
      updates.scanSchedule = body.scanSchedule;
    if (body.packageManager !== undefined)
      updates.packageManager = body.packageManager;
    if (body.verifyMode !== undefined) updates.verifyMode = body.verifyMode;
    if (body.serverId !== undefined) {
      if (body.serverId) {
        const [server] = await db
          .select({ id: servers.id })
          .from(servers)
          .where(
            and(
              eq(servers.id, body.serverId),
              eq(servers.organizationId, orgId)
            )
          );
        if (!server) return c.json({ error: "Server not found" }, 404);
      }
      updates.serverId = body.serverId;
    }

    if (body.clientId !== undefined) {
      if (body.clientId) {
        const [cl] = await db
          .select({ id: clients.id })
          .from(clients)
          .where(
            and(
              eq(clients.id, body.clientId),
              eq(clients.organizationId, orgId)
            )
          );
        if (!cl) return c.json({ error: "Client not found" }, 404);
      }
      updates.clientId = body.clientId;
    }

    // Resulting toggle state after this patch.
    const merged = {
      autoFixCritical: body.autoFixCritical ?? existing.autoFixCritical,
      autoMerge: body.autoMerge ?? existing.autoMerge,
      autoDeploy: body.autoDeploy ?? existing.autoDeploy,
    };
    // Auto-merge / auto-deploy perform destructive, unattended actions – they
    // require a real authenticated session (reject the demo-org bypass).
    const enablingAutonomy =
      (body.autoMerge === true && !existing.autoMerge) ||
      (body.autoDeploy === true && !existing.autoDeploy) ||
      (body.autoRollback === true && !existing.autoRollback);
    if (enablingAutonomy && !c.get("session")) {
      return c.json(
        {
          error:
            "Enabling auto-merge or auto-deploy requires an authenticated session.",
        },
        401
      );
    }
    // Strict escalation ladder: autoDeploy ⇒ autoMerge ⇒ autoFixCritical.
    if (merged.autoDeploy && !merged.autoMerge) {
      return c.json(
        { error: "auto-deploy requires auto-merge to be enabled." },
        400
      );
    }
    if (merged.autoMerge && !merged.autoFixCritical) {
      return c.json(
        {
          error:
            "auto-merge requires auto-fix for critical CVEs to be enabled.",
        },
        400
      );
    }
    if (merged.autoMerge || merged.autoDeploy) {
      const [integ] = await db
        .select({ automationPolicy: orgIntegrations.automationPolicy })
        .from(orgIntegrations)
        .where(eq(orgIntegrations.organizationId, orgId));
      const policy = resolveAutomationPolicy(integ?.automationPolicy);
      if (policy.requirePrReview) {
        return c.json(
          {
            error:
              "This organization requires pull-request review: auto-merge and auto-deploy are disabled under Settings → Automation.",
          },
          400
        );
      }
    }

    const [repo] = await db
      .update(repositories)
      .set(updates)
      .where(eq(repositories.id, id))
      .returning();
    // The unattended-action switches matter most: record before → after.
    const toggles = Object.fromEntries(
      (
        [
          "autoFixCritical",
          "autoFixForce",
          "autoMerge",
          "autoDeploy",
          "autoRollback",
          "autoHeal",
        ] as const
      )
        .filter((k) => body[k] !== undefined && body[k] !== existing[k])
        .map((k) => [k, `${existing[k]} → ${body[k]}`])
    );
    if (
      updates.dokployApplicationId !== undefined &&
      updates.dokployApplicationId !== existing.dokployApplicationId
    ) {
      syncDokployForOrg(orgId).catch(() => {});
    }
    await audit(c, "repo.update", repoTarget(existing), {
      fields: Object.keys(body),
      ...toggles,
    });
    const [last] = await db
      .select({ startedAt: scans.startedAt })
      .from(scans)
      .where(eq(scans.repositoryId, id))
      .orderBy(desc(scans.startedAt))
      .limit(1);
    return c.json({
      ...repo!,
      nextScanAt: nextScanAtFor(
        repo!.scanSchedule,
        repo!.lastScannedAt,
        last?.startedAt ?? null
      ),
    });
  })
  .delete("/:id", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!existing) return c.json({ error: "Repository not found" }, 404);
    await db.delete(repositories).where(eq(repositories.id, id));
    await audit(c, "repo.delete", repoTarget(existing));
    return c.json({ deleted: true });
  })
  .get("/:id/scans", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const list = await db
      .select()
      .from(scans)
      .where(eq(scans.repositoryId, id))
      .orderBy(desc(scans.startedAt));
    return c.json(list);
  })
  .get("/:id/live-findings", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    // What the server-side tools found on this application's live URL:
    // Nuclei against the running app, Uptime Kuma monitors pointing at it.
    const rows = await db
      .select()
      .from(serverFindings)
      .where(
        and(
          eq(serverFindings.repositoryId, id),
          isNull(serverFindings.resolvedAt)
        )
      )
      .orderBy(desc(serverFindings.lastSeenAt))
      .limit(500);
    return c.json(rows);
  })
  .get("/:id/update-runs", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    // Newest first. The UI reads [0] to pick a run back up after a reload —
    // without it, an update in progress becomes invisible on refresh.
    const list = await db
      .select()
      .from(updateRuns)
      .where(eq(updateRuns.repositoryId, id))
      .orderBy(desc(updateRuns.triggeredAt))
      .limit(10);
    return c.json(list);
  })
  .get("/:id/deploy-runs", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    // Newest first: the UI shows the latest one, including whether watching
    // the live URL afterwards confirmed anything.
    // Opening the page should not show a failure a later Dokploy deploy
    // already replaced.
    await reconcileFailedDeploys(id).catch(() => {});
    const list = await db
      .select()
      .from(deployRuns)
      .where(eq(deployRuns.repositoryId, id))
      .orderBy(desc(deployRuns.triggeredAt))
      .limit(10);
    return c.json(list);
  })
  .post("/:id/live-check", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const result = await runLiveCheck(id);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result.state);
  })
  .get("/:id/dokploy-domains", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    if (!repo.dokployApplicationId) {
      return c.json({ error: "No Dokploy application ID for this repo." }, 400);
    }
    const dokploy = await resolveDokployConfig(orgId);
    if (!dokploy.ok) return c.json({ error: dokploy.error }, 400);
    const urls = await fetchApplicationDomains({
      baseUrl: dokploy.config.baseUrl,
      token: dokploy.config.token,
      applicationId: repo.dokployApplicationId,
      kind: repo.dokployKind,
    });
    return c.json({ urls });
  })
  .post("/:id/scan", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const [scan] = await db
      .insert(scans)
      .values({ repositoryId: id, status: "pending" })
      .returning();
    if (scan) {
      console.log(`[api] Scan started: repo=${id} scanId=${scan.id}`);
      // Asked for by a person: the full scan, with unused dependencies —
      // unless they asked for the fast one (?fast=1).
      const full = c.req.query("fast") !== "1";
      runScan(id, scan.id, { full }).catch((err) => {
        console.error("[api] runScan error:", err);
      });
    }
    return c.json({ scanId: scan?.id, message: "Scan started" }, 202);
  })
  .post("/:id/scan-live", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    if (!repo.liveUrl && !hasDeployTarget(repo)) {
      return c.json(
        {
          error:
            "Set a live URL or link the Dokploy application — either tells which commit is deployed.",
        },
        400
      );
    }
    const started = await startLiveScan(id);
    if (!started.ok) return c.json({ error: started.error }, 400);
    const { scanId, commit, source } = started;
    return c.json(
      { scanId, commit, source, message: "Live scan started" },
      202
    );
  })
  .post("/:id/update", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      withAi?: boolean;
      target?: string;
    };
    const target = body.target === "latest" ? "latest" : "minor";
    const branchName = `deps/update-${Date.now()}`;
    const [run] = await db
      .insert(updateRuns)
      .values({
        repositoryId: id,
        branchName,
        status: "created",
        aiFixApplied: body.withAi ?? false,
      })
      .returning();
    if (run)
      runUpdateWorkflow(run.id, { withAi: body.withAi, target }).catch(
        () => {}
      );
    await audit(c, "repo.update_packages", repoTarget(repo));
    return c.json({ id: run!.id, branchName, status: run!.status }, 202);
  })
  .post("/:id/security-fix", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    // Don't stack security fixes: reuse an in-flight one if present.
    const active = await db
      .select()
      .from(updateRuns)
      .where(
        and(
          eq(updateRuns.repositoryId, id),
          eq(updateRuns.kind, "security"),
          inArray(updateRuns.status, [
            "created",
            "updating",
            "build_running",
            "deploying",
          ])
        )
      );
    if (active[0]) {
      return c.json(
        {
          id: active[0].id,
          branchName: active[0].branchName,
          status: active[0].status,
        },
        202
      );
    }
    const branchName = `security/cve-fix-${Date.now()}`;
    const [run] = await db
      .insert(updateRuns)
      .values({
        repositoryId: id,
        branchName,
        status: "created",
        kind: "security",
        triggerSource: "manual",
      })
      .returning();
    await audit(c, "repo.security_fix", repoTarget(repo), {
      source: "manual",
      runId: run?.id,
    });
    await audit(c, "security_fix.started", repoTarget(repo), {
      source: "manual",
      runId: run?.id,
      branchName,
    });
    if (run) {
      console.log(`[api] Manual security-fix: repo=${id} run=${run.id}`);
      runSecurityFix(run.id).catch((err) =>
        console.error("[api] runSecurityFix error:", err)
      );
    }
    return c.json({ id: run!.id, branchName, status: run!.status }, 202);
  })
  // Merge the run's PR on GitHub and (optionally) deploy it with Dokploy.
  .post(
    "/:id/update-runs/:runId/merge",
    zValidator("json", z.object({ deploy: z.boolean().default(true) })),
    async (c) => {
      const orgId = requireOrganization(c);
      if (orgId instanceof Response) return orgId;
      if (!c.get("session")) {
        return c.json(
          { error: "Merging requires an authenticated session." },
          401
        );
      }
      const id = c.req.param("id");
      const runId = c.req.param("runId");
      const [repo] = await db
        .select()
        .from(repositories)
        .where(
          and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
        );
      if (!repo) return c.json({ error: "Repository not found" }, 404);
      const [run] = await db
        .select({ repositoryId: updateRuns.repositoryId })
        .from(updateRuns)
        .where(eq(updateRuns.id, runId));
      if (!run || run.repositoryId !== id)
        return c.json({ error: "Run not found" }, 404);
      const { deploy } = c.req.valid("json");
      await audit(
        c,
        deploy ? "repo.merge_deploy" : "repo.merge",
        repoTarget(repo),
        {
          runId,
        }
      );
      const res = await mergeAndDeploy(runId, orgId, { deploy });
      if (!res.ok) return c.json({ error: res.error }, res.status);
      return c.json(res);
    }
  )
  // User journeys checked against the live URL.
  .get("/:id/checks", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repo = await ownRepo(orgId, c.req.param("id"));
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const rows = await db
      .select()
      .from(syntheticChecks)
      .where(eq(syntheticChecks.repositoryId, repo.id));
    return c.json({
      presets: PRESETS,
      checks: rows.map(({ secrets, ...r }) => ({
        ...r,
        hasSecrets: !!secrets,
      })),
    });
  })
  .post("/:id/checks", zValidator("json", checkSchema), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repo = await ownRepo(orgId, c.req.param("id"));
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    if (!repo.liveUrl) return c.json({ error: "Set a live URL first." }, 400);
    const b = c.req.valid("json");
    const [row] = await db
      .insert(syntheticChecks)
      .values({
        repositoryId: repo.id,
        name: b.name,
        steps: b.steps,
        secrets: sealSecrets(b.secrets ?? null),
        intervalMinutes: b.intervalMinutes ?? 15,
        enabled: b.enabled ?? true,
      })
      .returning({ id: syntheticChecks.id });
    await audit(c, "repo.check_create", repoTarget(repo), { name: b.name });
    void runCheck(row!.id).catch(() => {});
    return c.json({ id: row!.id }, 201);
  })
  .put("/:id/checks/:checkId", zValidator("json", checkSchema), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repo = await ownRepo(orgId, c.req.param("id"));
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const b = c.req.valid("json");
    const updated = await db
      .update(syntheticChecks)
      .set({
        name: b.name,
        steps: b.steps,
        ...(b.secrets !== undefined ? { secrets: sealSecrets(b.secrets) } : {}),
        ...(b.intervalMinutes ? { intervalMinutes: b.intervalMinutes } : {}),
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      })
      .where(
        and(
          eq(syntheticChecks.id, c.req.param("checkId")),
          eq(syntheticChecks.repositoryId, repo.id)
        )
      )
      .returning({ id: syntheticChecks.id });
    if (!updated.length) return c.json({ error: "Check not found" }, 404);
    return c.json({ ok: true });
  })
  .delete("/:id/checks/:checkId", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repo = await ownRepo(orgId, c.req.param("id"));
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    await db
      .delete(syntheticChecks)
      .where(
        and(
          eq(syntheticChecks.id, c.req.param("checkId")),
          eq(syntheticChecks.repositoryId, repo.id)
        )
      );
    return c.json({ ok: true });
  })
  .post("/:id/checks/:checkId/run", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repo = await ownRepo(orgId, c.req.param("id"));
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const [check] = await db
      .select({ id: syntheticChecks.id })
      .from(syntheticChecks)
      .where(
        and(
          eq(syntheticChecks.id, c.req.param("checkId")),
          eq(syntheticChecks.repositoryId, repo.id)
        )
      );
    if (!check) return c.json({ error: "Check not found" }, 404);
    return c.json(await runCheck(check.id));
  })
  // The application's page in Dokploy or Coolify.
  .get("/:id/platform-link", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, c.req.param("id")),
          eq(repositories.organizationId, orgId)
        )
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const target = appTarget(repo);
    if (!target) return c.json({ error: "No platform linked." }, 404);
    const p = platform(target.platform);
    const url = await p.dashboardUrl(orgId, target).catch(() => null);
    if (!url)
      return c.json(
        { error: `${p.label} did not say where the application lives.` },
        404
      );
    return c.json({ url, platform: p.label });
  })
  // Downtime history and uptime of the live URL.
  .get("/:id/incidents", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const [history, others, [home]] = await Promise.all([
      repoIncidents(id),
      locationsOf(id),
      db
        .select({
          status: repositories.liveStatus,
          httpStatus: repositories.liveHttpStatus,
          error: repositories.liveError,
          at: repositories.liveCheckedAt,
        })
        .from(repositories)
        .where(eq(repositories.id, id)),
    ]);
    const probes = new Set(configuredProbes().map((p) => p.name));
    // Where the site is checked from: here, and each probe still configured.
    const locations = [
      ...(home?.at
        ? [
            {
              name: process.env.PROBE_HOME_NAME?.trim() || "Moatline",
              ok: home.status === "up",
              httpStatus: home.httpStatus,
              error: home.error,
              checkedAt: home.at,
            },
          ]
        : []),
      ...others
        .filter((l) => probes.has(l.probe))
        .map((l) => ({
          name: l.probe,
          ok: l.ok,
          httpStatus: l.httpStatus,
          error: l.error,
          checkedAt: l.checkedAt,
        })),
    ];
    return c.json({ ...history, locations });
  })
  // What the repository's app logged as errors (agent 1.11.0+).
  .get("/:id/errors", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const hours = Math.min(
      168,
      Math.max(1, Number(c.req.query("hours")) || 24)
    );
    return c.json(await errorSummary({ repositoryId: id }, hours));
  })
  // Everything the last scan found, as a markdown task list for a coding
  // agent (Claude Code, Cursor …).
  .get("/:id/findings.md", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select({ id: repositories.id, name: repositories.name })
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const md = await buildFindingsReport(repo.id);
    if (md == null) return c.json({ error: "Repository not found" }, 404);
    const file = `findings-${repo.name.replace(/[^\w.-]+/g, "-")}.md`;
    c.header("content-type", "text/markdown; charset=utf-8");
    c.header("content-disposition", `attachment; filename="${file}"`);
    return c.body(md);
  })
  // Lighthouse history of the live site.
  .get("/:id/perf-runs", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const rows = await db
      .select()
      .from(perfRuns)
      .where(eq(perfRuns.repositoryId, id))
      .orderBy(desc(perfRuns.createdAt))
      .limit(120);
    return c.json(rows);
  })
  .post("/:id/perf", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const res = await runPerf(id, { trigger: "manual" });
    if (!res.ok) return c.json({ error: res.error ?? "Run failed" }, 400);
    return c.json(res.runs);
  })
  // Read-only security checks of the live site, now.
  .post("/:id/site-probe", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select({ id: repositories.id, liveUrl: repositories.liveUrl })
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    if (!repo.liveUrl) return c.json({ error: "Set a live URL first." }, 400);
    const probe = await probeSite(repo.id);
    if (!probe)
      return c.json({ error: "The live URL cannot be checked." }, 400);
    return c.json(probe);
  })
  // Repair package versions on a run's branch (the PR updates itself).
  .post("/:id/update-runs/:runId/align-versions", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const runId = c.req.param("runId");
    const [run] = await db
      .select({ repositoryId: updateRuns.repositoryId })
      .from(updateRuns)
      .where(eq(updateRuns.id, runId));
    if (!run || run.repositoryId !== id)
      return c.json({ error: "Run not found" }, 404);
    await audit(
      c,
      "repo.align_versions",
      { type: "repository", id },
      { runId }
    );
    const res = await alignRunBranch(runId, orgId);
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json(res);
  })
  // Undo a deploy: Dokploy rollback and/or a revert of its merge.
  .post("/:id/deploy-runs/:runId/rollback", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    if (!c.get("session")) {
      return c.json(
        { error: "Rolling back requires an authenticated session." },
        401
      );
    }
    const id = c.req.param("id");
    const [run] = await db
      .select({ id: deployRuns.id, repositoryId: deployRuns.repositoryId })
      .from(deployRuns)
      .innerJoin(repositories, eq(deployRuns.repositoryId, repositories.id))
      .where(
        and(
          eq(deployRuns.id, c.req.param("runId")),
          eq(repositories.id, id),
          eq(repositories.organizationId, orgId)
        )
      );
    if (!run) return c.json({ error: "Deploy not found" }, 404);
    await audit(
      c,
      "repo.rollback",
      { type: "repository", id },
      {
        deployRunId: run.id,
      }
    );
    const res = await rollbackDeploy(run.id, "manual");
    return c.json(res, res.ok ? 200 : 502);
  })
  .post("/:id/deploy", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.id, id), eq(repositories.organizationId, orgId))
      );
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    await audit(c, "repo.deploy", repoTarget(repo));
    const result = await deployRepository(id, null);
    if (!result.ok) {
      return c.json(
        { error: result.error, deployRunId: result.deployRunId },
        400
      );
    }
    return c.json({ ok: true, deployRunId: result.deployRunId }, 202);
  })
  // Every branch and whether it still holds work — merged ones can go.
  .get("/:id/branches", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repo = await ownRepo(orgId, c.req.param("id"));
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const host = await resolveRepo(repo.githubUrl, orgId);
    if (!host) return c.json({ error: "Not a repository URL." }, 400);
    const about = { host: host.label, canDelete: !!host.token };
    const cached = branchCache.get(repo.id);
    if (
      cached &&
      !c.req.query("refresh") &&
      Date.now() - cached.at < BRANCH_CACHE_MS
    )
      return c.json({
        ...cached.data,
        ...about,
        checkedAt: new Date(cached.at),
      });
    try {
      const data = await branchOverview(host.api, repo.defaultBranch);
      const at = Date.now();
      branchCache.set(repo.id, { at, data });
      return c.json({ ...data, ...about, checkedAt: new Date(at) });
    } catch (e) {
      return c.json(
        {
          error: `${host.label}: ${e instanceof Error ? e.message : "branches not readable"}${host.token ? "" : " — no token for this host."}`,
        },
        502
      );
    }
  })
  // Delete merged branches on the host. Each one is checked again first:
  // a branch with work that is not in the default branch is never deleted.
  .delete(
    "/:id/branches",
    zValidator("json", deleteBranchesSchema),
    async (c) => {
      const orgId = requireSession(c);
      if (orgId instanceof Response) return orgId;
      const repo = await ownRepo(orgId, c.req.param("id"));
      if (!repo) return c.json({ error: "Repository not found" }, 404);
      const host = await resolveRepo(repo.githubUrl, orgId);
      if (!host?.token)
        return c.json(
          {
            error: `No ${host?.label ?? "Git host"} token to delete branches with.`,
          },
          400
        );
      const { names } = c.req.valid("json");
      const fresh = await branchOverview(host.api, repo.defaultBranch).catch(
        () => null
      );
      if (!fresh)
        return c.json(
          { error: `${host.label} did not list the branches.` },
          502
        );
      const byName = new Map(fresh.branches.map((b) => [b.name, b]));
      const deleted: string[] = [];
      const refused: Array<{ name: string; reason: string }> = [];
      for (const name of names) {
        const row = byName.get(name);
        if (!row) {
          refused.push({ name, reason: "not found" });
          continue;
        }
        if (!deletable(row)) {
          refused.push({
            name,
            reason:
              row.status === "default"
                ? "default branch"
                : row.protected
                  ? "protected"
                  : "not merged",
          });
          continue;
        }
        const res = await host.api.deleteBranch(name);
        if (res.ok) deleted.push(name);
        else refused.push({ name, reason: res.error });
      }
      branchCache.delete(repo.id);
      await audit(c, "repo.branches_delete", repoTarget(repo), {
        deleted,
        refused: refused.map((r) => r.name),
      });
      return c.json({ deleted, refused });
    }
  )
  // Check the migrations now, not on the next round of the watcher.
  .post("/:id/migrations", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repo = await ownRepo(orgId, c.req.param("id"));
    if (!repo) return c.json({ error: "Repository not found" }, 404);
    const host = await resolveRepo(repo.githubUrl, orgId);
    if (!host) return c.json({ error: "Not a repository URL." }, 400);
    const head = await host.api
      .branchHead(repo.defaultBranch)
      .catch(() => null);
    const result = await checkMigrations(repo, host.api, { head, force: true });
    return c.json(result);
  });
