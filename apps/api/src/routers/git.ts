import { Hono } from "hono";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization } from "../middleware/tenant";
import { eq } from "drizzle-orm";
import { db, orgIntegrations, repositories } from "db";
import { getGithubToken, getGithubUserToken } from "../lib/github-token";
import {
  HOST_LABEL,
  listHostRepos,
  loadGitHosts,
  normalizeBase,
  repoKey,
  resolveRepo,
  type HostRepo,
} from "../lib/git-host";

const GITHUB_API = "https://api.github.com";

type GithubRepo = {
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
  pushed_at: string | null;
  description: string | null;
  language: string | null;
};

type InstallationRepo = {
  repositories: GithubRepo[];
  total_count: number;
};

/** Repositories a GitHub App installation can read. */
async function installationRepos(token: string): Promise<HostRepo[]> {
  const all: GithubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok)
      throw new Error(
        `GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`
      );
    const batch = (await res.json()) as InstallationRepo;
    all.push(...batch.repositories);
    if (batch.repositories.length < 100) break;
  }
  return all
    .filter((r) => !r.archived)
    .map((r) => ({
      fullName: r.full_name,
      url: r.html_url,
      defaultBranch: r.default_branch,
      private: r.private,
      pushedAt: r.pushed_at,
      description: r.description,
      language: r.language,
    }));
}

async function githubRepos(token: string): Promise<HostRepo[]> {
  const all: GithubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${GITHUB_API}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok)
      throw new Error(
        `GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`
      );
    const batch = (await res.json()) as GithubRepo[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all
    .filter((r) => !r.archived)
    .map((r) => ({
      fullName: r.full_name,
      url: r.html_url,
      defaultBranch: r.default_branch,
      private: r.private,
      pushedAt: r.pushed_at,
      description: r.description,
      language: r.language,
    }));
}

export const gitRouter = new Hono<{ Variables: TenantVariables }>()
  // Every repository the organization's tokens can read — GitHub and each
  // Git host from Settings — marked when it is already connected, so adding
  // one is a pick, not typing.
  .get("/repos", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [token, hosts, app] = await Promise.all([
      getGithubUserToken(orgId),
      loadGitHosts(orgId),
      db
        .select({ githubApp: orgIntegrations.githubApp })
        .from(orgIntegrations)
        .where(eq(orgIntegrations.organizationId, orgId))
        .then((r) => r[0]?.githubApp ?? null),
    ]);
    const sources = [
      // Each account the GitHub App is installed on.
      ...(app?.installations ?? []).map((i) => ({
        id: `github-app-${i.id}`,
        kind: "github" as const,
        label: `${HOST_LABEL.github} (${i.account})`,
        origin: "https://github.com",
        load: async () => {
          const t = await getGithubToken(orgId, i.account);
          if (!t) throw new Error("no token for the installation");
          return installationRepos(t);
        },
      })),
      ...(token
        ? [
            {
              id: "github",
              kind: "github" as const,
              label: HOST_LABEL.github,
              origin: "https://github.com",
              load: () => githubRepos(token),
            },
          ]
        : []),
      ...hosts.map((h) => ({
        id: h.id,
        kind: h.kind,
        label: HOST_LABEL[h.kind],
        origin: normalizeBase(h.url) ?? h.url,
        load: () => listHostRepos(h),
      })),
    ];
    if (!sources.length) {
      return c.json(
        {
          error:
            "No Git token configured – add GitHub or another Git host under Settings to list repositories",
        },
        503
      );
    }
    const results = await Promise.all(
      sources.map(async (s) => {
        try {
          return { s, repos: await s.load(), error: null };
        } catch (e) {
          return {
            s,
            repos: [] as HostRepo[],
            error: e instanceof Error ? e.message : "not reachable",
          };
        }
      })
    );
    const connected = await db
      .select({ githubUrl: repositories.githubUrl })
      .from(repositories)
      .where(eq(repositories.organizationId, orgId));
    const have = new Set(connected.map((r) => repoKey(r.githubUrl, hosts)));
    const seen = new Set<string | null>();
    if (results.every((r) => r.error))
      return c.json({ error: results.map((r) => r.error).join(" · ") }, 502);
    return c.json({
      sources: results.map(({ s, error, repos }) => ({
        id: s.id,
        kind: s.kind,
        label: s.label,
        origin: s.origin,
        count: repos.length,
        error,
      })),
      repos: results.flatMap(({ s, repos }) =>
        repos
          .filter((r) => {
            // The same repository through the app and a personal token: once.
            const k = repoKey(r.url, hosts);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .map((r) => ({
            ...r,
            host: s.kind,
            hostLabel: s.label,
            connected: have.has(repoKey(r.url, hosts)),
          }))
      ),
    });
  })
  // Branch names for the picker, from whichever host the URL points at.
  .get("/branches", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const url = c.req.query("url");
    if (!url?.trim())
      return c.json({ error: "Query param url is required" }, 400);
    const host = await resolveRepo(url, orgId);
    if (!host) return c.json({ error: "Not a repository URL" }, 400);
    if (!host.token)
      return c.json(
        {
          error: `No ${host.label} token configured – add one under Settings to list branches`,
        },
        503
      );
    try {
      const branches = await host.api.listBranches();
      return c.json({ branches: branches.map((b) => b.name) });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "branches not readable" },
        502
      );
    }
  });
