/**
 * Coolify v4 REST API (`{base}/api/v1`, `Authorization: Bearer <token>`).
 * The API is off by default in Coolify (Settings → API) and every action is
 * a POST. A token needs `read` and `deploy`; `read:sensitive` is never
 * needed — nothing here reads secrets.
 */

export type CoolifyConfig = { baseUrl: string; token: string };

export type CoolifyResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function api(base: string): string {
  return `${base.replace(/\/+$/, "").replace(/\/api\/v1$/, "")}/api/v1`;
}

async function call<T>(
  cfg: CoolifyConfig,
  method: "GET" | "POST",
  path: string,
  timeoutMs = 20_000
): Promise<CoolifyResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${api(cfg.baseUrl)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Coolify not reachable: ${e instanceof Error ? e.message : "network error"}`,
    };
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = (body as { message?: unknown } | null)?.message;
    return {
      ok: false,
      error:
        res.status === 401
          ? "Coolify refused the token (HTTP 401)"
          : res.status === 403
            ? `Coolify: ${typeof msg === "string" ? msg : "forbidden"} (HTTP 403) — is the API enabled and does the token have read and deploy?`
            : `Coolify answered HTTP ${res.status}${typeof msg === "string" ? `: ${msg.slice(0, 200)}` : ""}`,
    };
  }
  return { ok: true, data: body as T };
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const rows = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object") as Array<
        Record<string, unknown>
      >)
    : [];

export type CoolifyKind = "application" | "service" | "database";

export type CoolifyResource = {
  uuid: string;
  kind: CoolifyKind;
  name: string;
  /** "running:healthy", "exited:unhealthy" … */
  status: string | null;
  /** Applications: "owner/repo" lowercased, when from GitHub. */
  githubRepo: string | null;
  branch: string | null;
  /** Applications: first https domain. */
  url: string | null;
  /** Databases: e.g. "standalone-postgresql". */
  databaseType: string | null;
  isPublic: boolean;
  publicPort: number | null;
  /** Its environment's id — resolved to the dashboard link. */
  environmentId: number | null;
  /** Databases: scheduled backups and their newest run. */
  backups: Array<{
    enabled: boolean;
    lastStatus: string | null;
    lastAt: string | null;
  }>;
};

/** "owner/repo" of a git_repository value ("owner/repo", https or ssh URL). */
export function githubRepoOf(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  return /^[\w.-]+\/[\w.-]+$/.test(s)
    ? s.replace(/\.git$/i, "").toLowerCase()
    : null;
}

function firstUrl(fqdn: unknown): string | null {
  const list = (str(fqdn) ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return list.find((u) => u.startsWith("https://")) ?? list[0] ?? null;
}

export function parseApplications(body: unknown): CoolifyResource[] {
  return rows(body)
    .filter((a) => str(a.uuid))
    .map((a) => ({
      uuid: str(a.uuid)!,
      kind: "application" as const,
      name: str(a.name) ?? str(a.uuid)!,
      status: str(a.status),
      githubRepo: githubRepoOf(a.git_repository),
      environmentId: Number.isInteger(a.environment_id)
        ? (a.environment_id as number)
        : null,
      branch: str(a.git_branch),
      url: firstUrl(a.fqdn),
      databaseType: null,
      isPublic: false,
      publicPort: null,
      backups: [],
    }));
}

export function parseDatabases(body: unknown): CoolifyResource[] {
  return rows(body)
    .filter((d) => str(d.uuid))
    .map((d) => {
      const port = Number(d.public_port);
      return {
        uuid: str(d.uuid)!,
        kind: "database" as const,
        name: str(d.name) ?? str(d.uuid)!,
        status: str(d.status),
        githubRepo: null,
        branch: null,
        url: null,
        databaseType: str(d.database_type),
        environmentId: Number.isInteger(d.environment_id)
          ? (d.environment_id as number)
          : null,
        isPublic: d.is_public === true,
        publicPort: Number.isInteger(port) && port > 0 ? port : null,
        backups: rows(d.backup_configs).map((b) => {
          const log = (b.latest_log ?? null) as Record<string, unknown> | null;
          return {
            enabled: b.enabled !== false,
            lastStatus: str(log?.status),
            lastAt: str(log?.created_at) ?? str(log?.updated_at),
          };
        }),
      };
    });
}

export function parseServices(body: unknown): CoolifyResource[] {
  return rows(body)
    .filter((s) => str(s.uuid))
    .map((s) => ({
      uuid: str(s.uuid)!,
      kind: "service" as const,
      name: str(s.name) ?? str(s.uuid)!,
      status: str(s.status),
      githubRepo: null,
      branch: null,
      url: null,
      databaseType: null,
      environmentId: Number.isInteger(s.environment_id)
        ? (s.environment_id as number)
        : null,
      isPublic: false,
      publicPort: null,
      backups: [],
    }));
}

/** Everything Coolify runs: applications, services, databases. */
export async function listResources(
  cfg: CoolifyConfig
): Promise<CoolifyResult<CoolifyResource[]>> {
  const [apps, services, dbs] = await Promise.all([
    call<unknown>(cfg, "GET", "/applications"),
    call<unknown>(cfg, "GET", "/services"),
    call<unknown>(cfg, "GET", "/databases"),
  ]);
  if (!apps.ok) return apps;
  return {
    ok: true,
    data: [
      ...parseApplications(apps.data),
      ...(services.ok ? parseServices(services.data) : []),
      ...(dbs.ok ? parseDatabases(dbs.data) : []),
    ],
  };
}

/** Whether Coolify deploys this application by itself on a push. */
export async function autoDeploys(
  cfg: CoolifyConfig,
  uuid: string
): Promise<boolean> {
  const r = await call<Record<string, unknown>>(
    cfg,
    "GET",
    `/applications/${encodeURIComponent(uuid)}`
  );
  if (!r.ok || !r.data) return false;
  const settings = (r.data.settings ?? {}) as Record<string, unknown>;
  return (
    settings.is_auto_deploy_enabled === true ||
    r.data.is_auto_deploy_enabled === true
  );
}

/** Start a deployment; the deployment's uuid, to follow its status. */
export async function deployApplication(
  cfg: CoolifyConfig,
  uuid: string
): Promise<CoolifyResult<{ deploymentUuid: string | null }>> {
  const r = await call<{ deployments?: Array<{ deployment_uuid?: string }> }>(
    cfg,
    "POST",
    `/deploy?uuid=${encodeURIComponent(uuid)}&force=false`,
    30_000
  );
  if (!r.ok) return r;
  return {
    ok: true,
    data: { deploymentUuid: str(r.data?.deployments?.[0]?.deployment_uuid) },
  };
}

/** queued / in_progress → running, finished → done, failed / cancelled → error. */
export function deploymentState(
  status: string | null
): "running" | "done" | "error" | null {
  if (!status) return null;
  if (status === "finished") return "done";
  if (status === "failed" || status.startsWith("cancelled")) return "error";
  return "running";
}

export async function deploymentStatus(
  cfg: CoolifyConfig,
  deploymentUuid: string
): Promise<"running" | "done" | "error" | null> {
  const r = await call<{ status?: string }>(
    cfg,
    "GET",
    `/deployments/${encodeURIComponent(deploymentUuid)}`
  );
  return r.ok ? deploymentState(str(r.data?.status)) : null;
}

/** Restart without rebuilding: applications, databases and services alike. */
export async function restartResource(
  cfg: CoolifyConfig,
  kind: CoolifyKind,
  uuid: string
): Promise<CoolifyResult<unknown>> {
  const base =
    kind === "application"
      ? "applications"
      : kind === "database"
        ? "databases"
        : "services";
  return call(
    cfg,
    "POST",
    `/${base}/${encodeURIComponent(uuid)}/restart`,
    60_000
  );
}

/**
 * The Coolify resource a reported container belongs to. Coolify puts the
 * resource's uuid into every container name: `<uuid>-<time>` for
 * applications, `<uuid>` for databases, `<service>-<uuid>` for services.
 */
export function resourceOfContainer<T extends { uuid: string }>(
  container: { app?: string | null; name?: string | null },
  resources: T[]
): T | null {
  const hay = `${container.name ?? ""} ${container.app ?? ""}`;
  return (
    resources.find((r) => r.uuid.length >= 10 && hay.includes(r.uuid)) ?? null
  );
}

/**
 * Coolify's environment ids → the project and environment uuids its web
 * interface links with (/project/<p>/environment/<e>/<kind>/<uuid>).
 */
export async function environmentPaths(
  cfg: CoolifyConfig
): Promise<Map<number, { project: string; environment: string }>> {
  const out = new Map<number, { project: string; environment: string }>();
  const projects = await call<unknown>(cfg, "GET", "/projects");
  if (!projects.ok) return out;
  for (const p of rows(projects.data).slice(0, 100)) {
    const uuid = str(p.uuid);
    if (!uuid) continue;
    const envs = await call<unknown>(
      cfg,
      "GET",
      `/projects/${encodeURIComponent(uuid)}/environments`
    );
    if (!envs.ok) continue;
    for (const e of rows(envs.data))
      if (Number.isInteger(e.id) && str(e.uuid))
        out.set(e.id as number, { project: uuid, environment: str(e.uuid)! });
  }
  return out;
}

export function coolifyDashboardUrl(
  baseUrl: string,
  r: { kind: CoolifyKind; uuid: string },
  path: { project: string; environment: string } | undefined
): string | null {
  if (!path) return null;
  const base = baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${base}/project/${path.project}/environment/${path.environment}/${r.kind}/${r.uuid}`;
}

/** The Coolify version ("4.0.0-beta.420"), or null. */
export async function coolifyVersion(
  cfg: CoolifyConfig
): Promise<string | null> {
  const r = await call<unknown>(cfg, "GET", "/version");
  if (!r.ok) return null;
  const v = typeof r.data === "string" ? r.data : null;
  return v ? v.trim().replace(/^v/i, "") : null;
}
