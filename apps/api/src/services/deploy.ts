import { and, desc, eq } from "drizzle-orm";
import {
  db,
  repositories,
  deployRuns,
  orgIntegrations,
  packageFindings,
  scans,
} from "db";
import { listDeployments, type DokployKind } from "../lib/dokploy";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { platform, repoTarget } from "./platforms";
import { notify } from "../lib/notify";
import { watchDeployLive } from "./live-check";
import { guardDeploy } from "./deploy-guard";
import { emitEvent } from "../lib/events";

export type DokployConfig = { baseUrl: string; token: string };

/**
 * The organization's Dokploy credentials, decrypted. Shared with the live-URL
 * suggestion endpoint so both paths agree on where the panel is and how the
 * token is stored.
 */
export async function resolveDokployConfig(
  organizationId: string
): Promise<{ ok: true; config: DokployConfig } | { ok: false; error: string }> {
  const [integ] = await db
    .select()
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, organizationId));
  if (!integ?.dokployBaseUrl || !integ?.dokployToken) {
    return {
      ok: false,
      error: "Dokploy is not configured for this organization.",
    };
  }
  try {
    const token = isEncrypted(integ.dokployToken)
      ? decryptSecret(integ.dokployToken)
      : integ.dokployToken;
    return { ok: true, config: { baseUrl: integ.dokployBaseUrl, token } };
  } catch {
    return { ok: false, error: "Could not decrypt the Dokploy token." };
  }
}

/**
 * The state of the deployment Dokploy started for this trigger: the newest
 * one created around or after it. null while it is not listed yet.
 */
export async function dokployBuildStatus(
  config: DokployConfig,
  applicationId: string,
  kind: DokployKind,
  since: Date
): Promise<"running" | "done" | "error" | null> {
  const list = await listDeployments({ ...config, applicationId, kind });
  // A merge can start more than one deployment (the push webhook and the
  // trigger), and Dokploy may retry. One that succeeded is what counts; it
  // is only a failure when every attempt failed and none is still going.
  const mine = (list ?? []).filter(
    (d) => d.createdAt && Date.parse(d.createdAt) >= since.getTime() - 60_000
  );
  return buildStateOf(mine.map((d) => d.status));
}

export function buildStateOf(
  statuses: Array<string | null>
): "running" | "done" | "error" | null {
  if (!statuses.length) return null;
  if (statuses.includes("done")) return "done";
  if (statuses.every((s) => s === "error")) return "error";
  return "running";
}

/** Whether the repository's latest scan found `payload` among its dependencies. */
export async function usesPayload(repositoryId: string): Promise<boolean> {
  const [last] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(eq(scans.repositoryId, repositoryId), eq(scans.status, "success"))
    )
    .orderBy(desc(scans.startedAt))
    .limit(1);
  if (!last) return false;
  const [hit] = await db
    .select({ id: packageFindings.id })
    .from(packageFindings)
    .where(
      and(
        eq(packageFindings.scanId, last.id),
        eq(packageFindings.packageName, "payload")
      )
    )
    .limit(1);
  return !!hit;
}

export type DeployOutcome = {
  ok: boolean;
  deployRunId?: string;
  error?: string;
};

/**
 * Deploy a repository on its platform (Dokploy, Coolify …) and record it as
 * a deploy run. Reusable for the autonomous security-fix path and manual
 * deploys.
 *
 * `afterMerge`: the default branch just moved. If the platform deploys that
 * branch on every push by itself, its webhook is already building — a
 * second trigger would only build the same commit twice. The run is then
 * recorded and watched, not triggered.
 */
export async function deployRepository(
  repositoryId: string,
  updateRunId?: string | null,
  /** guard: act on a broken deploy (off for the deploy of a rollback). */
  opts: { afterMerge?: boolean; guard?: boolean } = {}
): Promise<DeployOutcome> {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId));
  if (!repo) return { ok: false, error: "Repository not found" };
  const target = repoTarget(repo);
  if (!target) {
    return {
      ok: false,
      error: "No Dokploy or Coolify application linked to this repo.",
    };
  }
  const p = platform(target.platform);
  if (!(await p.configured(repo.organizationId)))
    return {
      ok: false,
      error: `${p.label} is not configured for this organization.`,
    };

  const [deployRow] = await db
    .insert(deployRuns)
    .values({
      repositoryId,
      updateRunId: updateRunId ?? null,
      // The column predates other platforms; it records whose deploy it was.
      dokployApplicationId:
        target.platform === "dokploy"
          ? target.appId
          : `${target.platform}:${target.appId}`,
      status: "triggered",
    })
    .returning();

  const viaWebhook =
    !!opts.afterMerge &&
    (await p
      .deploysPushItself(repo.organizationId, target, repo.defaultBranch)
      .catch(() => false));
  const res = viaWebhook
    ? ({ ok: true, ref: null } as const)
    : await p.deploy(repo.organizationId, target, {
        title: "Moatline deploy",
      });

  if (!res.ok) {
    await db
      .update(deployRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: res.error,
      })
      .where(eq(deployRuns.id, deployRow!.id));
    await notify(repo.organizationId, {
      type: "workflow_failed",
      title: `Deploy failed for ${repo.name}`,
      message: res.error,
    }).catch(() => {});
    return { ok: false, deployRunId: deployRow!.id, error: res.error };
  }

  await db
    .update(deployRuns)
    .set({ status: "succeeded", finishedAt: new Date() })
    .where(eq(deployRuns.id, deployRow!.id));
  emitEvent(repo.organizationId, {
    name: "deploy.started",
    title: `Deploy of ${repo.name} started on ${p.label}`,
    severity: "info",
    repository: repo,
    attributes: {
      platform: target.platform,
      "deploy.id": deployRow!.id,
      "deploy.via_webhook": viaWebhook,
      "vcs.ref.head.name": repo.defaultBranch,
    },
  });
  await notify(repo.organizationId, {
    type: "deploy_triggered",
    title: `Deploy triggered for ${repo.name}`,
    message: viaWebhook
      ? `${p.label} deploys the merge by itself (auto deploy on push).`
      : `${p.label} accepted the deploy request.`,
    url: repo.githubUrl,
  }).catch(() => {});
  // "Accepted" is all a platform says at first. With a live URL, keep
  // watching in the background so the run ends with what actually happened
  // out there instead of what was requested.
  if (repo.liveUrl) {
    // Payload's admin breaks on its own (version mismatches, missing
    // migrations) while the site still renders: check it too.
    const extraPaths = (await usesPayload(repo.id).catch(() => false))
      ? ["/admin"]
      : [];
    const ref = res.ref;
    watchDeployLive({
      extraPaths,
      repositoryId: repo.id,
      deployRunId: deployRow!.id,
      organizationId: repo.organizationId,
      repoName: repo.name,
      url: repo.liveUrl,
      previousCommit: repo.liveCommit,
      buildStatus: () =>
        p.buildStatus(repo.organizationId, target, deployRow!.triggeredAt, ref),
    })
      .then((result) =>
        opts.guard === false ? null : guardDeploy(repo, deployRow!.id, result)
      )
      .catch((err) => console.error("[api] deploy watch error:", err));
  }
  return { ok: true, deployRunId: deployRow!.id };
}
