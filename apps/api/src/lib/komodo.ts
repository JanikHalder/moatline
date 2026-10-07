/**
 * Komodo Core API (komo.do): every call is a POST to `{base}/read/<Type>`,
 * `/write/<Type>` or `/execute/<Type>` with the params as JSON, signed with
 * an API key and secret (`X-Api-Key`, `X-Api-Secret`; Komodo → Settings →
 * API keys). Moatline only reads and executes deploys and restarts.
 */

export type KomodoConfig = { baseUrl: string; key: string; secret: string };

export type KomodoResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function call<T>(
  cfg: KomodoConfig,
  kind: "read" | "execute",
  type: string,
  params: Record<string, unknown> = {},
  timeoutMs = 20_000
): Promise<KomodoResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/${kind}/${type}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.key,
        "x-api-secret": cfg.secret,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Komodo not reachable: ${e instanceof Error ? e.message : "network error"}`,
    };
  }
  const text = await res.text().catch(() => "");
  if (!res.ok)
    return {
      ok: false,
      error:
        res.status === 401 || res.status === 403
          ? `Komodo refused the API key (HTTP ${res.status})`
          : `Komodo answered HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  try {
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch {
    return { ok: false, error: "Komodo did not answer with JSON." };
  }
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const rows = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object") as Array<
        Record<string, unknown>
      >)
    : [];

/** Komodo ids come as "id" or, from older versions, as `_id: { $oid }`. */
export function komodoId(v: Record<string, unknown> | null): string | null {
  if (!v) return null;
  const raw = v.id ?? v._id;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object")
    return str((raw as { $oid?: unknown }).$oid);
  return null;
}

export type KomodoResource = {
  id: string;
  kind: "stack" | "deployment";
  name: string;
  /** "running", "down" … lowercased. */
  state: string | null;
  server: string | null;
  /** Stacks from Git: the repository as a URL (https://github.com/o/r). */
  repoUrl: string | null;
  branch: string | null;
  /** Deployments: the image, which tells a database from an app. */
  image: string | null;
};

/** Where a stack's code comes from, as a URL a repository can match. */
function repoUrlOf(info: Record<string, unknown>): string | null {
  const repo = str(info.repo);
  if (!repo) return null;
  if (/^https?:\/\//.test(repo)) return repo;
  const provider = str(info.git_provider) ?? "github.com";
  return `https://${provider.replace(/^https?:\/\//, "")}/${repo}`;
}

/** Every stack and deployment Komodo manages. */
export async function listKomodo(
  cfg: KomodoConfig
): Promise<KomodoResult<KomodoResource[]>> {
  const [stacks, deployments] = await Promise.all([
    call<unknown>(cfg, "read", "ListStacks"),
    call<unknown>(cfg, "read", "ListDeployments"),
  ]);
  if (!stacks.ok) return stacks;
  const out: KomodoResource[] = [];
  for (const s of rows(stacks.data)) {
    const id = komodoId(s);
    const name = str(s.name);
    if (!id || !name) continue;
    const info = (s.info ?? {}) as Record<string, unknown>;
    out.push({
      id,
      kind: "stack",
      name,
      state: str(info.state)?.toLowerCase() ?? null,
      server: str(info.server_name) ?? str(info.server_id),
      repoUrl: repoUrlOf(info),
      branch: str(info.branch),
      image: null,
    });
  }
  for (const d of deployments.ok ? rows(deployments.data) : []) {
    const id = komodoId(d);
    const name = str(d.name);
    if (!id || !name) continue;
    const info = (d.info ?? {}) as Record<string, unknown>;
    out.push({
      id,
      kind: "deployment",
      name,
      state: str(info.state)?.toLowerCase() ?? null,
      server: str(info.server_id),
      repoUrl: null,
      branch: null,
      image: str(info.image),
    });
  }
  return { ok: true, data: out };
}

/**
 * Deploy a stack (pulls its repository and runs `compose up`) or a
 * deployment. The update id follows the progress.
 */
export async function komodoDeploy(
  cfg: KomodoConfig,
  kind: "stack" | "deployment",
  id: string
): Promise<KomodoResult<{ updateId: string | null }>> {
  const r =
    kind === "stack"
      ? await call<Record<string, unknown>>(cfg, "execute", "DeployStack", {
          stack: id,
        })
      : await call<Record<string, unknown>>(cfg, "execute", "Deploy", {
          deployment: id,
        });
  return r.ok ? { ok: true, data: { updateId: komodoId(r.data) } } : r;
}

export async function komodoRestart(
  cfg: KomodoConfig,
  kind: "stack" | "deployment",
  id: string
): Promise<KomodoResult<null>> {
  const r =
    kind === "stack"
      ? await call(cfg, "execute", "RestartStack", { stack: id })
      : await call(cfg, "execute", "RestartDeployment", { deployment: id });
  return r.ok ? { ok: true, data: null } : r;
}

/** State of an update (a deploy): running, done, error. */
export async function komodoUpdateState(
  cfg: KomodoConfig,
  updateId: string
): Promise<"running" | "done" | "error" | null> {
  const r = await call<{ status?: string; success?: boolean }>(
    cfg,
    "read",
    "GetUpdate",
    { id: updateId }
  );
  if (!r.ok || !r.data) return null;
  if (String(r.data.status ?? "").toLowerCase() !== "complete")
    return "running";
  return r.data.success ? "done" : "error";
}

/** The Komodo version — the connection test. */
export async function komodoVersion(
  cfg: KomodoConfig
): Promise<KomodoResult<string>> {
  const r = await call<{ version?: string }>(cfg, "read", "GetVersion");
  return r.ok ? { ok: true, data: r.data?.version ?? "?" } : r;
}

/** Images that are databases, not apps. */
export const DATABASE_IMAGE =
  /(^|\/)(postgres|postgis|mysql|mariadb|mongo|redis|valkey|keydb|dragonfly|clickhouse|timescaledb)(:|@|$)/i;

/**
 * The resource a container belongs to: deployments name their container
 * after themselves, stacks are compose projects named after the stack
 * (the agent reports compose containers as "<project>-<service>").
 */
export function komodoOfContainer<T extends KomodoResource>(
  container: { app?: string | null; name?: string | null },
  resources: T[]
): T | null {
  const app = (container.app ?? "").toLowerCase();
  const name = (container.name ?? "").toLowerCase();
  let best: T | null = null;
  for (const r of resources) {
    const n = r.name.toLowerCase();
    const hit =
      r.kind === "deployment"
        ? app === n || name === n
        : app.startsWith(`${n}-`) || app.startsWith(`${n}_`);
    if (hit && (!best || n.length > best.name.length)) best = r;
  }
  return best;
}
