export type DeployResult = { ok: boolean; status: number; body: string };

/** Dokploy runs two kinds of services: applications and compose stacks. */
export type DokployKind = "application" | "compose";

/** `{ applicationId }` or `{ composeId }` — how Dokploy addresses each kind. */
function idParam(kind: DokployKind | null | undefined, id: string) {
  return kind === "compose" ? { composeId: id } : { applicationId: id };
}
function idQuery(kind: DokployKind | null | undefined, id: string): string {
  return kind === "compose"
    ? `composeId=${encodeURIComponent(id)}`
    : `applicationId=${encodeURIComponent(id)}`;
}

/**
 * Trigger a Dokploy application deploy.
 * `POST {baseUrl}/api/application.deploy` with an `x-api-key` header.
 * Dokploy exposes no reliable completion poll, so a 200 means "accepted",
 * not "live".
 */
export async function triggerDeploy(opts: {
  baseUrl: string;
  token: string;
  applicationId: string;
  kind?: DokployKind | null;
  title?: string;
  description?: string;
}): Promise<DeployResult> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/${opts.kind ?? "application"}.deploy`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        "x-api-key": opts.token,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        ...idParam(opts.kind, opts.applicationId),
        ...(opts.title ? { title: opts.title } : {}),
        ...(opts.description ? { description: opts.description } : {}),
      }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : "network error",
    };
  }
  const body = (await res.text().catch(() => "")).slice(0, 500);
  return { ok: res.ok, status: res.status, body };
}

export type DokployDomain = {
  host: string;
  https: boolean;
  path: string | null;
};

/**
 * Ask Dokploy which domains point at an application, so the live URL can be
 * offered instead of typed. Failure is deliberately soft — a suggestion that
 * cannot be fetched is a missing convenience, not an error worth surfacing.
 */
export async function fetchApplicationDomains(opts: {
  baseUrl: string;
  token: string;
  applicationId: string;
  kind?: DokployKind | null;
}): Promise<string[]> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/${
    opts.kind === "compose" ? "domain.byComposeId" : "domain.byApplicationId"
  }?${idQuery(opts.kind, opts.applicationId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "x-api-key": opts.token, accept: "application/json" },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return [];
  }
  const rows: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray((body as { result?: { data?: unknown } })?.result?.data)
      ? ((body as { result: { data: unknown[] } }).result.data as unknown[])
      : [];
  const urls = rows
    .map((row) => {
      const d = row as Partial<DokployDomain>;
      if (!d || typeof d.host !== "string" || !d.host.trim()) return null;
      const scheme = d.https ? "https" : "http";
      const path = d.path && d.path !== "/" ? d.path : "";
      return `${scheme}://${d.host}${path}`;
    })
    .filter((u): u is string => u !== null);
  return [...new Set(urls)];
}

export type DokployApplication = {
  /** The application's id — or the compose stack's, see `kind`. */
  applicationId: string;
  kind: DokployKind;
  name: string;
  /** Docker Swarm service name — also the name of the image Dokploy builds. */
  appName: string;
  project: string;
  environment: string | null;
  /** "owner/repo" for GitHub sources, lowercased; null for anything else. */
  githubRepo: string | null;
  branch: string | null;
  /** Dokploy redeploys by itself on a push to the branch (GitHub webhook). */
  autoDeploy: boolean;
  projectId?: string | null;
  /** Dokploy's remote server it runs on; null on the Dokploy host itself. */
  serverId?: string | null;
  /** Its environment (Dokploy since 2025-09); part of the dashboard link. */
  environmentId?: string | null;
};

function rowsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const data = (body as { result?: { data?: unknown } })?.result?.data;
  return Array.isArray(data) ? data : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** "owner/repo" from an application's GitHub or custom git source. */
function githubRepoOf(a: Record<string, unknown>): string | null {
  const owner = str(a.owner);
  const repo = str(a.repository);
  if (owner && repo) return `${owner}/${repo}`.toLowerCase();
  const git = str(a.customGitUrl);
  const m = git?.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

type Ctx = {
  project: string;
  environment: string | null;
  projectId?: string | null;
  environmentId?: string | null;
};

/** Dokploy's database services, each with its own `<kind>Id`. */
export const DATABASE_KINDS = [
  "postgres",
  "mysql",
  "mariadb",
  "mongo",
  "redis",
] as const;
export type DokployDatabaseKind = (typeof DATABASE_KINDS)[number];

/** Anything Dokploy runs: an application, a compose stack or a database. */
export type DokployService = Omit<DokployApplication, "kind"> & {
  kind: DokployKind | DokployDatabaseKind;
};

function toService(
  a: Record<string, unknown>,
  ctx: Ctx
): DokployService | null {
  // Backups, domains, deployments and mounts point at a service by its id
  // too — they are not services themselves.
  if (a.backupId || a.domainId || a.deploymentId || a.mountId) return null;
  const appName = str(a.appName);
  if (!appName) return null;
  let kind: DokployService["kind"] | null = str(a.applicationId)
    ? "application"
    : str(a.composeId)
      ? "compose"
      : null;
  if (!kind) kind = DATABASE_KINDS.find((k) => str(a[`${k}Id`])) ?? null;
  if (!kind) return null;
  return {
    applicationId: str(a[`${kind}Id`])!,
    kind,
    name: str(a.name) ?? appName,
    appName,
    project: ctx.project,
    environment: ctx.environment,
    githubRepo: githubRepoOf(a),
    branch: str(a.branch) ?? str(a.customGitBranch),
    autoDeploy: a.autoDeploy === true,
    projectId: ctx.projectId ?? str(a.projectId),
    environmentId: ctx.environmentId ?? str(a.environmentId),
    serverId: str(a.serverId),
  };
}

function isApplication(s: DokployService): s is DokployApplication {
  return s.kind === "application" || s.kind === "compose";
}

function toApplication(
  a: Record<string, unknown>,
  ctx: Ctx
): DokployApplication | null {
  const s = toService(a, ctx);
  return s && isApplication(s) ? s : null;
}

/**
 * Pull only the application fields out of a Dokploy response. The shape
 * moved between versions (applications on the project, then inside
 * environments, sometimes wrapped), so the whole tree is searched for
 * objects that look like an application, remembering the project and
 * environment above them. The response also carries database passwords
 * and env vars of every service — none of that is kept or passed on.
 */
export function parseApplications(
  body: unknown,
  ctx: Ctx = { project: "Project", environment: null }
): DokployApplication[] {
  return parseServices(body, ctx).filter(isApplication);
}

/** Like `parseApplications`, databases included. */
export function parseServices(
  body: unknown,
  ctx: Ctx = { project: "Project", environment: null }
): DokployService[] {
  const found = new Map<string, DokployService>();
  const walk = (
    node: unknown,
    c: Ctx,
    depth: number,
    key: string | null
  ): void => {
    if (depth > 8 || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, c, depth + 1, key);
      return;
    }
    const o = node as Record<string, unknown>;
    const app = toService(o, c);
    if (app) {
      if (!found.has(app.applicationId)) found.set(app.applicationId, app);
      return; // nothing of interest below an application
    }
    let next = c;
    const isProject =
      !!str(o.projectId) ||
      Array.isArray(o.environments) ||
      Array.isArray(o.applications);
    const isEnvironment = !!str(o.environmentId) || key === "environments";
    if (isProject && str(o.name) && !isEnvironment)
      next = {
        project: str(o.name)!,
        environment: null,
        projectId: str(o.projectId),
      };
    else if (isEnvironment && str(o.name))
      next = {
        ...c,
        environment: str(o.name),
        environmentId: str(o.environmentId) ?? c.environmentId ?? null,
      };
    for (const [k, v] of Object.entries(o)) walk(v, next, depth + 1, k);
  };
  walk(body, ctx, 0, null);
  return [...found.values()];
}

async function getJson(
  base: string,
  token: string,
  path: string
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/${path}`, {
      headers: { "x-api-key": token, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Dokploy not reachable: ${e instanceof Error ? e.message : "network error"}`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.status === 401 || res.status === 403
          ? `Dokploy refused the API key (HTTP ${res.status})`
          : `Dokploy answered HTTP ${res.status}`,
    };
  }
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, error: "Dokploy sent no JSON" };
  }
}

/** Projects (id + name) anywhere in a project.all response. */
function projectsOf(body: unknown): Array<{ id: string; name: string }> {
  const rows = rowsOf(body).length
    ? rowsOf(body)
    : rowsOf((body as { json?: unknown })?.json);
  return rows
    .map((r) => r as Record<string, unknown>)
    .filter((r) => str(r.projectId))
    .map((r) => ({ id: str(r.projectId)!, name: str(r.name) ?? "Project" }));
}

/** Run `fn` over `items`, a few at a time. */
async function pool<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    })
  );
}

/**
 * Some Dokploy versions list services without their git source. Without it
 * nothing can be matched to a repository — so ask for those one by one.
 */
async function withSource(
  base: string,
  token: string,
  apps: DokployApplication[]
): Promise<void> {
  const missing = apps.filter((a) => !a.githubRepo).slice(0, 500);
  await pool(missing, 5, async (a) => {
    const res = await getJson(
      base,
      token,
      `${a.kind}.one?${idQuery(a.kind, a.applicationId)}`
    );
    if (!res.ok || !res.body || typeof res.body !== "object") return;
    const full = toApplication(res.body as Record<string, unknown>, {
      project: a.project,
      environment: a.environment,
      projectId: a.projectId,
    });
    if (full) Object.assign(a, { ...full, kind: a.kind });
  });
}

/** Every project through the paged search, in case project.all holds back. */
async function searchProjects(
  base: string,
  token: string
): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  for (let page = 0; page < 20; page++) {
    const res = await getJson(
      base,
      token,
      `project.search?limit=100&offset=${page * 100}`
    );
    if (!res.ok) break;
    const body = res.body as { items?: unknown; data?: unknown } | null;
    const rows = rowsOf(body).length
      ? rowsOf(body)
      : Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.data)
          ? body.data
          : [];
    const found = projectsOf(rows);
    out.push(...found);
    if (rows.length < 100) break;
  }
  return out;
}

export async function listApplications(opts: {
  baseUrl: string;
  token: string;
}): Promise<
  | { ok: true; apps: DokployApplication[]; projects: number }
  | { ok: false; error: string }
> {
  const res = await listServices(opts);
  if (!res.ok) return res;
  const apps = res.apps.filter(isApplication);
  if (apps.length) return { ok: true, apps, projects: res.projects };
  return {
    ok: false,
    error: res.projects
      ? `Dokploy lists ${res.projects} project(s) but no applications or compose services this API key can see — a key of a member without access to the projects sees none.`
      : "Dokploy lists no projects for this API key.",
  };
}

/** Every service Dokploy runs — applications, compose stacks, databases. */
export async function listServices(opts: {
  baseUrl: string;
  token: string;
}): Promise<
  | { ok: true; apps: DokployService[]; projects: number }
  | { ok: false; error: string }
> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const all = await getJson(base, opts.token, "project.all");
  if (!all.ok) return all;
  const apps = parseServices(all.body);
  const add = (found: DokployService[]) => {
    for (const a of found)
      if (!apps.some((x) => x.applicationId === a.applicationId)) apps.push(a);
  };

  // Every project, from both lists — and each one project.all came back
  // without services for is asked for on its own. Newer Dokploy versions
  // leave services out of project.all for some projects; trusting it meant
  // silently missing them.
  const projects = new Map<string, string>();
  for (const p of [
    ...projectsOf(all.body),
    ...(await searchProjects(base, opts.token).catch(() => [])),
  ])
    projects.set(p.id, p.name);
  const covered = new Set(
    apps
      .filter(isApplication)
      .map((a) => a.projectId)
      .filter(Boolean)
  );
  const todo = [...projects].filter(([id]) => !covered.has(id));
  await pool(todo, 5, async ([id, name]) => {
    const q = `projectId=${encodeURIComponent(id)}`;
    for (const path of [`environment.byProjectId?${q}`, `project.one?${q}`]) {
      const res = await getJson(base, opts.token, path);
      if (!res.ok) continue;
      const found = parseServices(res.body, {
        project: name,
        environment: null,
        projectId: id,
      });
      add(found);
      if (found.length) break;
    }
  });

  await withSource(base, opts.token, apps.filter(isApplication));
  apps.sort(
    (a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name)
  );
  return { ok: true, apps, projects: projects.size };
}

/**
 * Redeploy one service. Applications and compose stacks are rebuilt from
 * their source (`redeploy`); a database is deployed again — Dokploy
 * recreates its container on the same volume, the data stays.
 */
export async function redeployService(opts: {
  baseUrl: string;
  token: string;
  id: string;
  kind: DokployService["kind"];
}): Promise<DeployResult> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const action =
    opts.kind === "application" || opts.kind === "compose"
      ? "redeploy"
      : "deploy";
  let res: Response;
  try {
    res = await fetch(`${base}/api/${opts.kind}.${action}`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        "x-api-key": opts.token,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        [`${opts.kind}Id`]: opts.id,
        ...(action === "redeploy" ? { title: "Moatline redeploy" } : {}),
      }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : "network error",
    };
  }
  const body = (await res.text().catch(() => "")).slice(0, 500);
  return { ok: res.ok, status: res.status, body };
}

/**
 * The Dokploy service a reported container belongs to. Applications and
 * databases run as a Swarm service named exactly like their appName;
 * compose stacks prefix every service with it ("<appName>-web",
 * "<appName>_web"). The longest name wins, so "shop-x1-api" never lands on
 * "shop".
 */
export function serviceOfContainer<T extends { appName: string }>(
  container: { app?: string | null; name?: string | null },
  services: T[]
): T | null {
  const app = container.app || container.name || "";
  const name = container.name || "";
  let best: T | null = null;
  for (const s of services) {
    const n = s.appName;
    const hit =
      app === n ||
      app.startsWith(`${n}-`) ||
      app.startsWith(`${n}_`) ||
      name.startsWith(`${n}.`);
    if (hit && (!best || n.length > best.appName.length)) best = s;
  }
  return best;
}

/** "owner/repo" of a https://github.com/owner/repo URL, lowercased. */
export function githubRepoOfUrl(url: string): string | null {
  // Owner and repo are the first two path segments — whatever follows
  // (/tree/main, .git, a trailing slash) is not part of the name.
  const m = url.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  return m ? `${m[1]}/${m[2]!.replace(/\.git$/i, "")}`.toLowerCase() : null;
}

/**
 * The Dokploy application that deploys this repository: same GitHub repo,
 * preferably the same branch. Ambiguous (e.g. staging and production from
 * one branch) → null; the user picks.
 */
export function matchApplication(
  repo: { githubUrl: string; defaultBranch: string },
  apps: DokployApplication[]
): DokployApplication | null {
  const slug = githubRepoOfUrl(repo.githubUrl);
  if (!slug) return null;
  const same = apps.filter((a) => a.githubRepo === slug);
  const onBranch = same.filter((a) => a.branch === repo.defaultBranch);
  const pick = onBranch.length ? onBranch : same;
  return pick.length === 1 ? pick[0]! : null;
}

export type DokployDeployment = {
  deploymentId: string;
  status: string | null;
  createdAt: string | null;
  /** Set when Dokploy kept the image for a rollback (rollbacks enabled). */
  rollbackId: string | null;
  /**
   * The commit Dokploy built, when it says: deploys from the GitHub webhook
   * carry it ("Hash: <sha>" in the description, or a commit field).
   */
  commit: string | null;
};

/** A full or short commit SHA in a deployment's fields. */
export function deploymentCommit(r: Record<string, unknown>): string | null {
  for (const key of ["commitHash", "commit", "sha", "hash"]) {
    const v = str(r[key]);
    if (v && /^[0-9a-f]{7,40}$/i.test(v)) return v.toLowerCase();
  }
  const text = [str(r.description), str(r.title)].filter(Boolean).join(" ");
  const m =
    text.match(/\b(?:hash|commit|sha)\s*[:=]?\s*([0-9a-f]{7,40})\b/i) ??
    text.match(/\b([0-9a-f]{40})\b/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** An application's deployments, newest first. */
export async function listDeployments(opts: {
  baseUrl: string;
  token: string;
  applicationId: string;
  kind?: DokployKind | null;
}): Promise<DokployDeployment[] | null> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const res = await getJson(
    base,
    opts.token,
    opts.kind === "compose"
      ? `deployment.allByCompose?${idQuery("compose", opts.applicationId)}`
      : `deployment.all?${idQuery("application", opts.applicationId)}`
  );
  if (!res.ok) return null;
  return rowsOf(res.body)
    .map((r) => r as Record<string, unknown>)
    .filter((r) => str(r.deploymentId))
    .map((r) => {
      const rb = r.rollback as Record<string, unknown> | null | undefined;
      return {
        deploymentId: str(r.deploymentId)!,
        status: str(r.status),
        createdAt: str(r.createdAt),
        rollbackId: str(r.rollbackId) ?? str(rb?.rollbackId),
        commit: deploymentCommit(r),
      };
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Put a kept image back into service — no rebuild. */
export async function rollbackTo(opts: {
  baseUrl: string;
  token: string;
  rollbackId: string;
}): Promise<DeployResult> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/rollback.rollback`, {
      method: "POST",
      headers: {
        "x-api-key": opts.token,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ rollbackId: opts.rollbackId }),
      signal: AbortSignal.timeout(30_000),
    });
    return {
      ok: res.ok,
      status: res.status,
      body: (await res.text().catch(() => "")).slice(0, 500),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : "network error",
    };
  }
}

/** Variable names in a Dokploy env text ("KEY=value" lines) — values dropped. */
export function envKeys(env: string): string[] {
  const keys = new Set<string>();
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
    );
    // An empty value is as good as missing.
    if (m && m[2]!.replace(/^["']|["']$/g, "").trim()) keys.add(m[1]!);
  }
  return [...keys];
}

/**
 * Which environment variables an application has — names only. The value
 * text leaves this function never: it is parsed and dropped right here.
 */
export async function applicationEnvKeys(opts: {
  baseUrl: string;
  token: string;
  applicationId: string;
  kind?: DokployKind | null;
}): Promise<string[] | null> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const res = await getJson(
    base,
    opts.token,
    `${opts.kind ?? "application"}.one?${idQuery(opts.kind, opts.applicationId)}`
  );
  if (!res.ok) return null;
  const app = (res.body as { env?: unknown; buildArgs?: unknown }) ?? {};
  return envKeys(
    [app.env, app.buildArgs].filter((x) => typeof x === "string").join("\n")
  );
}

export type DokployBackup = {
  backupId: string;
  enabled: boolean;
  schedule: string | null;
  database: string | null;
  destination: string | null;
  /** The newest run, when this Dokploy version records runs. */
  lastRun: { status: string | null; at: string | null } | null;
};

export type DatabaseDetails = {
  /** Port published on the server — reachable from outside unless firewalled. */
  externalPort: number | null;
  backups: DokployBackup[];
};

/** The newest entry of a deployments list: status and time. */
function newestRun(list: unknown): DokployBackup["lastRun"] {
  if (!Array.isArray(list) || !list.length) return null;
  const rows = list
    .map((r) => r as Record<string, unknown>)
    .filter((r) => r && typeof r === "object")
    .sort((a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
    );
  const r = rows[0];
  return r ? { status: str(r.status), at: str(r.createdAt) } : null;
}

export function parseDatabaseDetails(body: unknown): DatabaseDetails {
  const o = (body ?? {}) as Record<string, unknown>;
  const port = Number(o.externalPort);
  const backups = (Array.isArray(o.backups) ? o.backups : [])
    .map((b) => b as Record<string, unknown>)
    .filter((b) => b && str(b.backupId))
    .map((b) => ({
      backupId: str(b.backupId)!,
      enabled: b.enabled !== false,
      schedule: str(b.schedule),
      database: str(b.database),
      destination: str((b.destination as Record<string, unknown>)?.name),
      lastRun: newestRun(b.deployments),
    }));
  return {
    externalPort: Number.isInteger(port) && port > 0 ? port : null,
    backups,
  };
}

/**
 * External port and backups of one database. Only these fields are read —
 * the response also carries the database password, which is dropped here.
 */
export async function databaseDetails(opts: {
  baseUrl: string;
  token: string;
  id: string;
  kind: DokployDatabaseKind;
}): Promise<
  { ok: true; details: DatabaseDetails } | { ok: false; error: string }
> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const res = await getJson(
    base,
    opts.token,
    `${opts.kind}.one?${opts.kind}Id=${encodeURIComponent(opts.id)}`
  );
  if (!res.ok) return res;
  return { ok: true, details: parseDatabaseDetails(res.body) };
}

/**
 * Free disk space on a Dokploy server: the build cache (safe, only slows the
 * next build) or every unused image (also the ones a rollback would use).
 * Volumes are never touched.
 */
export async function cleanDocker(opts: {
  baseUrl: string;
  token: string;
  what: "builder" | "images";
  /** Dokploy's remote server; omitted for the Dokploy host itself. */
  serverId: string | null;
}): Promise<DeployResult> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const path =
    opts.what === "builder"
      ? "settings.cleanDockerBuilder"
      : "settings.cleanUnusedImages";
  let res: Response;
  try {
    res = await fetch(`${base}/api/${path}`, {
      signal: AbortSignal.timeout(120_000),
      method: "POST",
      headers: {
        "x-api-key": opts.token,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(opts.serverId ? { serverId: opts.serverId } : {}),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : "network error",
    };
  }
  const body = (await res.text().catch(() => "")).slice(0, 500);
  return { ok: res.ok, status: res.status, body };
}

export type DokployServer = {
  serverId: string;
  name: string;
  ipAddress: string | null;
};

/** Dokploy's remote servers (the Dokploy host itself is not listed). */
export async function listDokployServers(opts: {
  baseUrl: string;
  token: string;
}): Promise<
  { ok: true; servers: DokployServer[] } | { ok: false; error: string }
> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const res = await getJson(base, opts.token, "server.all");
  if (!res.ok) return res;
  const servers = rowsOf(res.body)
    .map((r) => r as Record<string, unknown>)
    .filter((r) => r && str(r.serverId))
    .map((r) => ({
      serverId: str(r.serverId)!,
      name: str(r.name) ?? str(r.serverId)!,
      ipAddress: str(r.ipAddress),
    }));
  return { ok: true, servers };
}

/**
 * Restart a service without rebuilding: Dokploy's reload stops and starts
 * the container of an application. Compose stacks have no reload — they
 * are redeployed.
 */
export async function restartService(opts: {
  baseUrl: string;
  token: string;
  id: string;
  kind: DokployKind;
  appName: string;
}): Promise<DeployResult> {
  if (opts.kind === "compose")
    return redeployService({ ...opts, kind: "compose" });
  const base = opts.baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/application.reload`, {
      signal: AbortSignal.timeout(60_000),
      method: "POST",
      headers: {
        "x-api-key": opts.token,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ applicationId: opts.id, appName: opts.appName }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : "network error",
    };
  }
  const body = (await res.text().catch(() => "")).slice(0, 500);
  return { ok: res.ok, status: res.status, body };
}

/** A Dokploy procedure call for provisioning: the parsed answer or why not. */
export async function dokployPost<T = unknown>(
  opts: { baseUrl: string; token: string },
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/${path}`, {
      signal: AbortSignal.timeout(60_000),
      method: "POST",
      headers: {
        "x-api-key": opts.token,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Dokploy not reachable: ${e instanceof Error ? e.message : "network error"}`,
    };
  }
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data as { message?: unknown } | null)?.message ??
      (typeof data === "string" ? data : null);
    return {
      ok: false,
      error: `${path}: HTTP ${res.status}${msg ? ` — ${String(msg).slice(0, 300)}` : ""}`,
    };
  }
  return { ok: true, data: data as T };
}

export async function dokployGet<T = unknown>(
  opts: { baseUrl: string; token: string },
  path: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await getJson(opts.baseUrl.replace(/\/+$/, ""), opts.token, path);
  return res.ok ? { ok: true, data: res.body as T } : res;
}

/**
 * Where a service lives in Dokploy's web interface. Dokploy with
 * environments: /dashboard/project/<p>/environment/<e>/services/<kind>/<id>;
 * before them: /dashboard/project/<p>/services/<kind>/<id>.
 */
export function dashboardUrl(
  baseUrl: string,
  s: {
    kind: string;
    applicationId: string;
    projectId?: string | null;
    environmentId?: string | null;
  }
): string | null {
  if (!s.projectId) return null;
  const base = baseUrl.replace(/\/+$/, "");
  const where = s.environmentId
    ? `project/${s.projectId}/environment/${s.environmentId}`
    : `project/${s.projectId}`;
  return `${base}/dashboard/${where}/services/${s.kind}/${s.applicationId}`;
}

/** The Dokploy version ("0.25.6"), or null when it does not say. */
export async function dokployVersion(opts: {
  baseUrl: string;
  token: string;
}): Promise<string | null> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const r = await getJson(base, opts.token, "settings.getDokployVersion");
  if (!r.ok) return null;
  const v =
    typeof r.body === "string"
      ? r.body
      : typeof (r.body as { json?: unknown })?.json === "string"
        ? (r.body as { json: string }).json
        : null;
  return v ? v.trim().replace(/^v/i, "") : null;
}
