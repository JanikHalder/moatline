/* eslint-disable @typescript-eslint/no-explicit-any --
   GitHub and Dokploy answers differ between versions; each field read here
   is checked before use (ids are required, everything else falls back). */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, domains, provisionRuns, repositories, scans } from "db";
import { dokployGet, dokployPost } from "../lib/dokploy";
import { getGithubUserToken } from "../lib/github-token";
import { validateLiveUrl } from "../lib/live-check";
import { resolveDokployConfig } from "./deploy";
import { runScan } from "./scan";

const GITHUB_API = "https://api.github.com";

// ---------------------------------------------------------------- helpers

/** "Müller Bau GmbH" → "muller-bau-gmbh" — for repository, app and db names. */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "site"
  );
}

/** Letters and digits only — valid for Dokploy and safe in a URL. */
export function randomPassword(length = 24): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Keys of a .env.example, with their example values. */
export function parseEnvExample(
  text: string
): Array<{ key: string; example: string }> {
  const out: Array<{ key: string; example: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !out.some((o) => o.key === m[1]))
      out.push({ key: m[1]!, example: m[2]!.replace(/^["']|["']$/g, "") });
  }
  return out;
}

export type EnvAuto = "database" | "secret" | "url" | null;

/** Which keys the wizard fills in by itself. */
export function autoKind(key: string): EnvAuto {
  if (
    /^(DATABASE_UR[IL]|DATABASE_URL|MONGODB_URI|MONGO_URL|POSTGRES_URL)$/.test(
      key
    )
  )
    return "database";
  if (
    /^(PAYLOAD_SECRET|NEXTAUTH_SECRET|AUTH_SECRET|PREVIEW_SECRET|CRON_SECRET|REVALIDATION_SECRET)$/.test(
      key
    )
  )
    return "secret";
  if (
    /^(NEXT_PUBLIC_SERVER_URL|SERVER_URL|NEXT_PUBLIC_SITE_URL|SITE_URL|PAYLOAD_PUBLIC_SERVER_URL|NEXT_PUBLIC_URL|APP_URL)$/.test(
      key
    )
  )
    return "url";
  return null;
}

/** The app's environment: template keys, filled where the wizard knows. */
export function buildEnv(
  keys: Array<{ key: string; example: string }>,
  ctx: { databaseUrl: string | null; siteUrl: string },
  given: Record<string, string>
): { env: string; filled: string[]; empty: string[] } {
  const lines: string[] = [];
  const filled: string[] = [];
  const empty: string[] = [];
  const all = [...keys];
  for (const k of Object.keys(given))
    if (!all.some((x) => x.key === k)) all.push({ key: k, example: "" });
  for (const { key } of all) {
    const auto = autoKind(key);
    const value =
      given[key]?.trim() ||
      (auto === "database"
        ? (ctx.databaseUrl ?? "")
        : auto === "secret"
          ? crypto.randomBytes(24).toString("hex")
          : auto === "url"
            ? ctx.siteUrl
            : "");
    if (value) filled.push(key);
    else empty.push(key);
    lines.push(`${key}=${value}`);
  }
  return { env: lines.join("\n"), filled, empty };
}

async function gh(
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      return {
        ok: false,
        error: `GitHub ${res.status}: ${(data as { message?: string } | null)?.message ?? "error"}`,
      };
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "GitHub not reachable",
    };
  }
}

// ---------------------------------------------------------------- options

export type ProvisionOptions = {
  templates: string[];
  owners: string[];
  dokploy:
    | {
        ok: true;
        environments: Array<{
          id: string;
          project: string;
          name: string;
          legacy: boolean;
        }>;
        servers: Array<{ id: string; name: string; ip: string | null }>;
        githubProviders: Array<{ id: string; name: string }>;
        destinations: Array<{ id: string; name: string }>;
      }
    | { ok: false; error: string };
  githubError: string | null;
};

/** What the wizard can choose from: templates, owners, Dokploy targets. */
export async function provisionOptions(
  organizationId: string
): Promise<ProvisionOptions> {
  const token = await getGithubUserToken(organizationId);
  let templates: string[] = [];
  let owners: string[] = [];
  let githubError: string | null = token ? null : "No GitHub token configured.";
  if (token) {
    const [repos, user, orgs] = await Promise.all([
      gh(
        token,
        "/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member"
      ),
      gh(token, "/user"),
      gh(token, "/user/orgs?per_page=100"),
    ]);
    if (repos.ok)
      templates = (
        repos.data as Array<{ full_name: string; is_template?: boolean }>
      )
        .filter((r) => r.is_template)
        .map((r) => r.full_name);
    else githubError = repos.error;
    owners = [
      ...(user.ok ? [(user.data as { login: string }).login] : []),
      ...(orgs.ok
        ? (orgs.data as Array<{ login: string }>).map((o) => o.login)
        : []),
    ];
  }

  const cfg = await resolveDokployConfig(organizationId);
  if (!cfg.ok) return { templates, owners, githubError, dokploy: cfg };
  const [projects, servers, providers, destinations] = await Promise.all([
    dokployGet<unknown>(cfg.config, "project.all"),
    dokployGet<unknown>(cfg.config, "server.all"),
    dokployGet<unknown>(cfg.config, "github.githubProviders"),
    dokployGet<unknown>(cfg.config, "destination.all"),
  ]);
  if (!projects.ok)
    return { templates, owners, githubError, dokploy: projects };
  const rows = (x: unknown): Array<Record<string, any>> =>
    Array.isArray(x)
      ? x
      : Array.isArray((x as any)?.result?.data)
        ? (x as any).result.data
        : [];
  const environments: Array<{
    id: string;
    project: string;
    name: string;
    legacy: boolean;
  }> = [];
  for (const p of rows(projects.data)) {
    const envs = Array.isArray(p.environments) ? p.environments : null;
    if (envs)
      for (const e of envs)
        if (e?.environmentId)
          environments.push({
            id: e.environmentId,
            project: p.name,
            name: e.name,
            legacy: false,
          });
    // Dokploy before environments (2025-09): services hang off the project.
    if (!envs && p.projectId)
      environments.push({
        id: p.projectId,
        project: p.name,
        name: "—",
        legacy: true,
      });
  }
  return {
    templates,
    owners,
    githubError,
    dokploy: {
      ok: true,
      environments,
      servers: servers.ok
        ? rows(servers.data).map((s) => ({
            id: s.serverId,
            name: s.name,
            ip: s.ipAddress ?? null,
          }))
        : [],
      githubProviders: providers.ok
        ? rows(providers.data).map((g) => ({
            id: g.githubId,
            name: g.gitProvider?.name ?? g.githubUrl ?? g.githubId,
          }))
        : [],
      // Only id and name: destination.all also returns the S3 secrets.
      destinations: destinations.ok
        ? rows(destinations.data).map((d) => ({
            id: d.destinationId,
            name: d.name,
          }))
        : [],
    },
  };
}

/** Keys of the template's .env.example, and which ones fill themselves. */
export async function templateEnv(
  organizationId: string,
  repo: string
): Promise<Array<{ key: string; example: string; auto: EnvAuto }>> {
  const token = await getGithubUserToken(organizationId);
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return [];
  for (const file of [".env.example", ".env.sample", ".env.template"]) {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${file}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      return parseEnvExample(await res.text()).map((k) => ({
        ...k,
        auto: autoKind(k.key),
      }));
    } catch {
      continue;
    }
  }
  return [];
}

// ---------------------------------------------------------------- the run

export type ProvisionInput = {
  name: string;
  clientId: string | null;
  source:
    | {
        kind: "template";
        template: string;
        owner: string;
        repo: string;
        private: boolean;
      }
    | { kind: "existing"; fullName: string };
  branch: string;
  environment: { id: string; legacy: boolean } | { newProject: string };
  serverId: string | null;
  githubProviderId: string;
  database: "postgres" | "mongo" | "none";
  backupDestinationId: string | null;
  domain: string;
  env: Record<string, string>;
  envKeys: Array<{ key: string; example: string }>;
  autoHeal: boolean;
};

type Step = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  detail?: string;
};

const STEPS: Array<[string, string]> = [
  ["repo", "GitHub repository"],
  ["project", "Dokploy project"],
  ["database", "Database"],
  ["backup", "Backup"],
  ["app", "Dokploy application"],
  ["domain", "Domain and certificate"],
  ["deploy", "First deploy"],
  ["monitoring", "Moatline monitoring"],
];

export async function startProvision(
  organizationId: string,
  input: ProvisionInput
): Promise<string> {
  const [run] = await db
    .insert(provisionRuns)
    .values({
      organizationId,
      name: input.name,
      steps: STEPS.map(([key, label]) => ({ key, label, status: "pending" })),
      input: {
        ...input,
        env: Object.keys(input.env),
        envKeys: input.envKeys.map((k) => k.key),
      },
    })
    .returning({ id: provisionRuns.id });
  void runProvision(run!.id, organizationId, input).catch(async (e) => {
    await db
      .update(provisionRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(provisionRuns.id, run!.id));
    console.error("[provision] failed:", e);
  });
  return run!.id;
}

class StepError extends Error {}

async function runProvision(
  runId: string,
  organizationId: string,
  input: ProvisionInput
): Promise<void> {
  const steps: Step[] = STEPS.map(([key, label]) => ({
    key,
    label,
    status: "pending",
  }));
  const save = (extra: Partial<typeof provisionRuns.$inferInsert> = {}) =>
    db
      .update(provisionRuns)
      .set({ steps, ...extra })
      .where(eq(provisionRuns.id, runId));
  const step = async <T>(
    key: string,
    fn: () => Promise<{ detail: string; value: T } | { skip: string }>
  ): Promise<T | null> => {
    const s = steps.find((x) => x.key === key)!;
    s.status = "running";
    await save();
    try {
      const r = await fn();
      if ("skip" in r) {
        s.status = "skipped";
        s.detail = r.skip;
        await save();
        return null;
      }
      s.status = "done";
      s.detail = r.detail;
      await save();
      return r.value;
    } catch (e) {
      s.status = "failed";
      s.detail = e instanceof Error ? e.message : String(e);
      await save({ status: "failed", finishedAt: new Date() });
      throw new StepError(s.detail);
    }
  };
  const must = <T>(
    r: { ok: true; data: T } | { ok: false; error: string }
  ): T => {
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };

  const token = await getGithubUserToken(organizationId);
  const cfg = await resolveDokployConfig(organizationId);
  try {
    if (!token) throw new StepError("No GitHub token configured.");
    if (!cfg.ok) throw new StepError(cfg.error);
  } catch (e) {
    steps[0]!.status = "failed";
    steps[0]!.detail = (e as Error).message;
    await save({ status: "failed", finishedAt: new Date() });
    return;
  }
  const dk = cfg.config;
  const slug = slugify(input.name);
  const siteUrl = `https://${input.domain}`;

  try {
    // 1. GitHub repository: from the template, or the one given.
    const repo = (await step("repo", async () => {
      if (input.source.kind === "existing") {
        const r = await gh(token, `/repos/${input.source.fullName}`);
        if (!r.ok) throw new Error(r.error);
        return {
          detail: `Using ${r.data.full_name}`,
          value: {
            owner: r.data.owner.login as string,
            name: r.data.name as string,
            url: r.data.html_url as string,
          },
        };
      }
      const s = input.source;
      const r = await gh(token, `/repos/${s.template}/generate`, {
        method: "POST",
        body: JSON.stringify({
          owner: s.owner,
          name: s.repo,
          private: s.private,
          include_all_branches: false,
        }),
      });
      if (!r.ok) throw new Error(r.error);
      // GitHub copies the files in the background; wait until the branch exists.
      for (let i = 0; i < 20; i++) {
        const b = await gh(
          token,
          `/repos/${r.data.full_name}/branches/${encodeURIComponent(input.branch)}`
        );
        if (b.ok) break;
        await new Promise((res) => setTimeout(res, 3000));
      }
      return {
        detail: `Created ${r.data.full_name} from ${s.template}`,
        value: {
          owner: r.data.owner.login as string,
          name: r.data.name as string,
          url: r.data.html_url as string,
        },
      };
    }))!;

    // 2. Where in Dokploy: an existing environment or a new project.
    const target = (await step("project", async () => {
      if ("id" in input.environment)
        return { detail: "Existing project", value: input.environment };
      const created = must(
        await dokployPost<any>(dk, "project.create", {
          name: input.environment.newProject,
        })
      );
      // Since environments: { project, environment }; before: the project row.
      if (created?.environment?.environmentId)
        return {
          detail: `Created project ${input.environment.newProject} (production)`,
          value: {
            id: created.environment.environmentId as string,
            legacy: false,
          },
        };
      if (created?.projectId)
        return {
          detail: `Created project ${input.environment.newProject}`,
          value: { id: created.projectId as string, legacy: true },
        };
      throw new Error("Dokploy created the project but returned no id.");
    }))!;
    const where = target.legacy
      ? { projectId: target.id }
      : { environmentId: target.id };

    // 3. Database.
    type Db = {
      kind: "postgres" | "mongo";
      id: string;
      name: string;
      url: string;
    };
    const database = await step<Db>("database", async () => {
      if (input.database === "none") return { skip: "No database" };
      const user = slug.replace(/-/g, "_").slice(0, 30) || "app";
      const password = randomPassword();
      if (input.database === "postgres") {
        const row = must(
          await dokployPost<any>(dk, "postgres.create", {
            name: `${input.name} DB`,
            appName: `${slug}-db`,
            databaseName: user,
            databaseUser: user,
            databasePassword: password,
            dockerImage: "postgres:17",
            serverId: input.serverId,
            ...where,
          })
        );
        must(
          await dokployPost(dk, "postgres.deploy", {
            postgresId: row.postgresId,
          })
        );
        return {
          detail: `PostgreSQL ${row.appName}`,
          value: {
            kind: "postgres",
            id: row.postgresId as string,
            name: user,
            url: `postgresql://${user}:${password}@${row.appName}:5432/${user}`,
          },
        };
      }
      const row = must(
        await dokployPost<any>(dk, "mongo.create", {
          name: `${input.name} DB`,
          appName: `${slug}-db`,
          databaseUser: user,
          databasePassword: password,
          dockerImage: "mongo:8",
          serverId: input.serverId,
          replicaSets: false,
          ...where,
        })
      );
      must(await dokployPost(dk, "mongo.deploy", { mongoId: row.mongoId }));
      return {
        detail: `MongoDB ${row.appName}`,
        value: {
          kind: "mongo",
          id: row.mongoId as string,
          name: user,
          url: `mongodb://${user}:${password}@${row.appName}:27017/${user}?authSource=admin&directConnection=true`,
        },
      };
    });

    // 4. Backup, daily at three.
    await step("backup", async () => {
      if (!database) return { skip: "No database" };
      if (!input.backupDestinationId)
        return { skip: "No backup destination chosen — add one in Dokploy" };
      must(
        await dokployPost(dk, "backup.create", {
          schedule: "0 3 * * *",
          prefix: slug,
          destinationId: input.backupDestinationId,
          database: database.name,
          databaseType: database.kind,
          enabled: true,
          keepLatestCount: 14,
          ...(database.kind === "postgres"
            ? { postgresId: database.id }
            : { mongoId: database.id }),
        })
      );
      return { detail: "Daily at 03:00, the last 14 kept", value: true };
    });

    // 5. Application: source, Dockerfile build, environment.
    const env = buildEnv(
      input.envKeys,
      { databaseUrl: database?.url ?? null, siteUrl },
      input.env
    );
    const app = (await step("app", async () => {
      const row = must(
        await dokployPost<any>(dk, "application.create", {
          name: input.name,
          appName: slug,
          serverId: input.serverId,
          ...where,
        })
      );
      const applicationId = row.applicationId as string;
      must(
        await dokployPost(dk, "application.saveGithubProvider", {
          applicationId,
          repository: repo.name,
          owner: repo.owner,
          branch: input.branch,
          buildPath: "/",
          githubId: input.githubProviderId,
          triggerType: "push",
          watchPaths: null,
          enableSubmodules: false,
        })
      );
      must(
        await dokployPost(dk, "application.saveBuildType", {
          applicationId,
          buildType: "dockerfile",
          dockerfile: "Dockerfile",
          dockerContextPath: "",
          dockerBuildStage: "",
          herokuVersion: null,
          railpackVersion: null,
        })
      );
      must(
        await dokployPost(dk, "application.saveEnvironment", {
          applicationId,
          env: env.env,
          buildArgs: null,
          buildSecrets: null,
          createEnvFile: true,
        })
      );
      return {
        detail: `${row.appName} · ${env.filled.length} variables set${env.empty.length ? `, empty: ${env.empty.join(", ")}` : ""}`,
        value: { applicationId, appName: row.appName as string },
      };
    }))!;

    // 6. Domain with Let's Encrypt.
    await step("domain", async () => {
      must(
        await dokployPost(dk, "domain.create", {
          host: input.domain,
          path: "/",
          port: 3000,
          https: true,
          certificateType: "letsencrypt",
          applicationId: app.applicationId,
          domainType: "application",
        })
      );
      return {
        detail: `${siteUrl} — the certificate is issued once the DNS points to the server`,
        value: true,
      };
    });

    // 7. First deploy.
    await step("deploy", async () => {
      must(
        await dokployPost(dk, "application.deploy", {
          applicationId: app.applicationId,
          title: "First deploy by Moatline",
        })
      );
      return { detail: "Started — the build takes a few minutes", value: true };
    });

    // 8. Moatline: repository, domain, first scan.
    await step("monitoring", async () => {
      const githubUrl = `https://github.com/${repo.owner}/${repo.name}`;
      const [row] = await db
        .insert(repositories)
        .values({
          organizationId,
          githubUrl,
          name: repo.name,
          defaultBranch: input.branch,
          packageJsonPath: "package.json",
          dokployApplicationId: app.applicationId,
          dokployAppName: app.appName,
          dokployKind: "application",
          liveUrl: validateLiveUrl(siteUrl).ok ? siteUrl : null,
          clientId: input.clientId,
          autoHeal: input.autoHeal,
          autoRollback: true,
        })
        .returning({ id: repositories.id });
      await db
        .insert(domains)
        .values({
          organizationId,
          clientId: input.clientId,
          name: input.domain.replace(/^www\./, ""),
          source: "manual",
        })
        .onConflictDoNothing();
      const [scan] = await db
        .insert(scans)
        .values({ repositoryId: row!.id, status: "pending" })
        .returning({ id: scans.id });
      if (scan) void runScan(row!.id, scan.id).catch(() => {});
      await db
        .update(provisionRuns)
        .set({ repositoryId: row!.id })
        .where(eq(provisionRuns.id, runId));
      return {
        detail: `Watched: live URL, uptime${input.autoHeal ? ", self-healing" : ""}, rollback, scans`,
        value: row!.id,
      };
    });
    await save({ status: "done", finishedAt: new Date() });
  } catch (e) {
    if (!(e instanceof StepError)) throw e;
  }
}
