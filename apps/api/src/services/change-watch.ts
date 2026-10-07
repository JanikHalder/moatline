import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, repositories, scans } from "db";
import { resolveRepo } from "../lib/git-host";
import { resolveDeployedCommit } from "./deployed-commit";
import { syncPullRequests } from "./pr-sync";
import { checkMigrations } from "./migration-guard";

const EVERY_MS = 5 * 60 * 1000;

async function scanning(repositoryId: string): Promise<boolean> {
  const [busy] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        eq(scans.repositoryId, repositoryId),
        inArray(scans.status, ["pending", "running"])
      )
    )
    .limit(1);
  return !!busy;
}

/**
 * Keep "what the code says" and "what runs" current without anyone pressing
 * scan: when the default branch moves on its host (a merge, a push), the
 * branch is scanned; when the deployed version changes (a deploy through
 * Moatline, Dokploy's push webhook, or one started in Dokploy), the
 * deployed commit is scanned. Fast lockfile scans, every few minutes.
 */
export async function runChangeWatch(): Promise<void> {
  const repos = await db
    .select()
    .from(repositories)
    .where(
      or(
        isNull(repositories.changesCheckedAt),
        lt(repositories.changesCheckedAt, new Date(Date.now() - EVERY_MS))
      )
    )
    .orderBy(asc(repositories.changesCheckedAt))
    .limit(60);
  // Lazy imports: the scan chain imports the deploy path.
  const { runScan } = await import("./scan");
  const { startLiveScan } = await import("./live-scan");
  for (const repo of repos) {
    const updates: Partial<typeof repositories.$inferInsert> = {
      changesCheckedAt: new Date(),
    };
    const host = await resolveRepo(repo.githubUrl, repo.organizationId).catch(
      () => null
    );
    const head = host
      ? await host.api.branchHead(repo.defaultBranch).catch(() => null)
      : null;
    if (host) {
      await syncPullRequests(repo, host.api).catch((e) =>
        console.error("[watch] PR sync failed:", e)
      );
      // Migrations in open PRs and undeployed commits, before they run.
      await checkMigrations(repo, host.api, { head }).catch((e) =>
        console.error("[watch] migration check failed:", e)
      );
    }
    let scanBranch = false;
    if (head && head !== repo.branchHead) {
      updates.branchHead = head;
      // The first look only records; no scan for a branch nobody changed.
      scanBranch = repo.branchHead != null;
    }
    const deployed = await resolveDeployedCommit(repo, repo.liveCommit).catch(
      () => null
    );
    let scanLive = false;
    if (deployed && deployed.sha !== repo.deployedCommit) {
      updates.deployedCommit = deployed.sha;
      scanLive = repo.deployedCommit != null;
    }
    await db
      .update(repositories)
      .set(updates)
      .where(eq(repositories.id, repo.id));
    if ((scanBranch || scanLive) && (await scanning(repo.id))) continue;
    if (scanBranch) {
      console.log(
        `[watch] ${repo.name}: ${repo.defaultBranch} moved — scanning`
      );
      await runScan(repo.id).catch((e) =>
        console.error("[watch] branch scan failed:", e)
      );
    }
    if (scanLive) {
      console.log(`[watch] ${repo.name}: deployed version changed — scanning`);
      const started = await startLiveScan(repo.id).catch(() => null);
      if (started?.ok) await started.done;
    }
  }
}
