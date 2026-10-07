import { eq } from "drizzle-orm";
import { db, repositories, servers } from "db";
import {
  fetchApplicationDomains,
  githubRepoOfUrl,
  type DokployApplication,
} from "../lib/dokploy";
import { isAllowedGitHubUrl } from "../lib/validate-github-url";
import { validateLiveUrl } from "../lib/live-check";
import { resolveDokployConfig } from "./deploy";
import { serverRunning, syncDokployForOrg } from "./dokploy-sync";

type Brief = Pick<
  DokployApplication,
  "applicationId" | "kind" | "name" | "project" | "environment" | "branch"
>;

export type ImportCandidate = Brief & {
  githubRepo: string;
  /** Other Dokploy services deploying the same repository and branch. */
  also: string[];
};

export type ImportPlan = {
  /** Not in Moatline yet. */
  candidates: ImportCandidate[];
  /** Already there (linked or same repository and branch). */
  existing: Array<Brief & { repositoryId: string; repositoryName: string }>;
  /** Dokploy services without a GitHub source — nothing to scan. */
  unsupported: Brief[];
};

const brief = (a: DokployApplication): Brief => ({
  applicationId: a.applicationId,
  kind: a.kind,
  name: a.name,
  project: a.project,
  environment: a.environment,
  branch: a.branch,
});

/** Production first, so a repository is linked to what customers see. */
const rank = (a: DokployApplication) =>
  /prod|live|main/i.test(a.environment ?? "") ? 0 : a.environment ? 1 : 2;

/**
 * What "add everything from Dokploy" would add: one repository per GitHub
 * repository and branch Dokploy deploys. Staging and production from one
 * branch become one repository, linked to the production service.
 */
export function planImport(
  apps: DokployApplication[],
  repos: Array<{
    id: string;
    name: string;
    githubUrl: string;
    defaultBranch: string;
    dokployApplicationId: string | null;
  }>
): ImportPlan {
  const plan: ImportPlan = { candidates: [], existing: [], unsupported: [] };
  const groups = new Map<string, DokployApplication[]>();
  for (const a of apps) {
    const linked = repos.find(
      (r) => r.dokployApplicationId === a.applicationId
    );
    const same =
      linked ??
      (a.githubRepo &&
        repos.find(
          (r) =>
            githubRepoOfUrl(r.githubUrl) === a.githubRepo &&
            (a.branch == null || r.defaultBranch === a.branch)
        ));
    if (same) {
      plan.existing.push({
        ...brief(a),
        repositoryId: same.id,
        repositoryName: same.name,
      });
    } else if (!a.githubRepo) {
      plan.unsupported.push(brief(a));
    } else {
      const key = `${a.githubRepo}#${a.branch ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
  }
  for (const group of groups.values()) {
    const [first, ...rest] = [...group].sort((x, y) => rank(x) - rank(y));
    plan.candidates.push({
      ...brief(first!),
      githubRepo: first!.githubRepo!,
      also: rest.map((r) =>
        [r.project, r.environment, r.name].filter(Boolean).join(" / ")
      ),
    });
  }
  plan.candidates.sort(
    (a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name)
  );
  return plan;
}

async function loadRepos(organizationId: string) {
  return db
    .select({
      id: repositories.id,
      name: repositories.name,
      githubUrl: repositories.githubUrl,
      defaultBranch: repositories.defaultBranch,
      dokployApplicationId: repositories.dokployApplicationId,
    })
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));
}

export async function dokployImportPlan(
  organizationId: string
): Promise<
  | { ok: true; plan: ImportPlan; apps: DokployApplication[] }
  | { ok: false; error: string }
> {
  // The sync links what it can first, so "existing" is up to date.
  const sync = await syncDokployForOrg(organizationId);
  if (!sync.ok) return sync;
  const repos = await loadRepos(organizationId);
  return { ok: true, plan: planImport(sync.apps, repos), apps: sync.apps };
}

/**
 * Add the chosen candidates as repositories, already linked to their
 * Dokploy service, server and live URL. Returns the new repository ids.
 */
export async function importFromDokploy(
  organizationId: string,
  applicationIds: string[]
): Promise<
  | { ok: true; created: Array<{ id: string; name: string }> }
  | { ok: false; error: string }
> {
  const res = await dokployImportPlan(organizationId);
  if (!res.ok) return res;
  const wanted = new Set(applicationIds);
  const chosen = res.plan.candidates.filter((c) => wanted.has(c.applicationId));
  if (!chosen.length) return { ok: true, created: [] };

  const cfg = await resolveDokployConfig(organizationId);
  const serverRows = await db
    .select({ id: servers.id, lastReport: servers.lastReport })
    .from(servers)
    .where(eq(servers.organizationId, organizationId));
  const names = new Set((await loadRepos(organizationId)).map((r) => r.name));
  const repoNames = chosen.map((c) => c.githubRepo.split("/")[1]!);

  const created: Array<{ id: string; name: string }> = [];
  for (const c of chosen) {
    const githubUrl = `https://github.com/${c.githubRepo}`;
    if (!isAllowedGitHubUrl(githubUrl)) continue;
    const app = res.apps.find((a) => a.applicationId === c.applicationId)!;
    const base = c.githubRepo.split("/")[1]!;
    // Two branches of one repository: tell them apart by the branch.
    let name =
      names.has(base) || repoNames.filter((n) => n === base).length > 1
        ? `${base} (${c.branch ?? c.environment ?? c.name})`
        : base;
    if (names.has(name)) name = `${name} · ${c.project}`;
    names.add(name);

    let liveUrl: string | null = null;
    if (cfg.ok) {
      const urls = await fetchApplicationDomains({
        ...cfg.config,
        applicationId: c.applicationId,
        kind: c.kind,
      }).catch(() => [] as string[]);
      liveUrl =
        [...urls]
          .sort(
            (a, b) =>
              Number(b.startsWith("https://")) -
              Number(a.startsWith("https://"))
          )
          .find((u) => validateLiveUrl(u).ok) ?? null;
    }

    const [row] = await db
      .insert(repositories)
      .values({
        organizationId,
        githubUrl,
        name,
        defaultBranch: c.branch ?? "main",
        packageJsonPath: "package.json",
        dokployApplicationId: c.applicationId,
        dokployAppName: app.appName,
        dokployKind: c.kind,
        serverId: serverRunning(app.appName, serverRows),
        liveUrl,
      })
      .returning({ id: repositories.id, name: repositories.name });
    if (row) created.push(row);
  }
  return { ok: true, created };
}
