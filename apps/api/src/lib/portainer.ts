/**
 * Portainer API (`{base}/api`, access token in `X-API-Key`; Portainer → My
 * account → Access tokens). Stacks deployed from a Git repository can be
 * redeployed from it; containers are restarted through Portainer's Docker
 * proxy for the stack's environment.
 */

export type PortainerConfig = { baseUrl: string; token: string };

export type PortainerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function api(base: string): string {
  return `${base.replace(/\/+$/, "").replace(/\/api$/, "")}/api`;
}

async function call<T>(
  cfg: PortainerConfig,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  timeoutMs = 20_000
): Promise<PortainerResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${api(cfg.baseUrl)}${path}`, {
      method,
      headers: {
        "x-api-key": cfg.token,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Portainer not reachable: ${e instanceof Error ? e.message : "network error"}`,
    };
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { message?: string; details?: string };
      msg = [j.message, j.details].filter(Boolean).join(": ") || msg;
    } catch {
      // not JSON
    }
    return {
      ok: false,
      error:
        res.status === 401
          ? "Portainer refused the access token (HTTP 401)"
          : `Portainer answered HTTP ${res.status}${msg ? `: ${msg}` : ""}`,
    };
  }
  try {
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch {
    return { ok: true, data: null as T };
  }
}

type RawStack = {
  Id: number;
  Name: string;
  EndpointId: number;
  /** 1 swarm, 2 compose, 3 kubernetes. */
  Type: number;
  /** 1 active, 2 inactive. */
  Status?: number;
  GitConfig?: { URL?: string; ReferenceName?: string } | null;
  AutoUpdate?: { Interval?: string; Webhook?: string } | null;
  Env?: Array<{ name: string; value: string }> | null;
};

export type PortainerStack = {
  /** "<environment id>:<stack id>" — a stack id alone needs its environment. */
  id: string;
  stackId: number;
  endpointId: number;
  name: string;
  type: "swarm" | "compose" | "kubernetes";
  active: boolean;
  /** Deployed from Git: the repository URL and branch. */
  repoUrl: string | null;
  branch: string | null;
  /** GitOps updates (polling or webhook) redeploy on a push by themselves. */
  autoUpdate: boolean;
};

export const portainerStackId = (endpointId: number, stackId: number) =>
  `${endpointId}:${stackId}`;

export function parsePortainerId(
  id: string
): { endpointId: number; stackId: number } | null {
  const m = id.match(/^(\d+):(\d+)$/);
  return m ? { endpointId: Number(m[1]), stackId: Number(m[2]) } : null;
}

function toStack(s: RawStack): PortainerStack {
  const ref = s.GitConfig?.ReferenceName ?? null;
  return {
    id: portainerStackId(s.EndpointId, s.Id),
    stackId: s.Id,
    endpointId: s.EndpointId,
    name: s.Name,
    type: s.Type === 1 ? "swarm" : s.Type === 3 ? "kubernetes" : "compose",
    active: s.Status !== 2,
    repoUrl: s.GitConfig?.URL?.trim() || null,
    branch: ref ? ref.replace(/^refs\/heads\//, "") : null,
    autoUpdate: !!(s.AutoUpdate?.Interval || s.AutoUpdate?.Webhook),
  };
}

export async function listPortainerStacks(
  cfg: PortainerConfig
): Promise<PortainerResult<PortainerStack[]>> {
  const r = await call<RawStack[]>(cfg, "GET", "/stacks");
  if (!r.ok) return r;
  return {
    ok: true,
    data: (Array.isArray(r.data) ? r.data : [])
      .filter((s) => s && Number.isInteger(s.Id) && s.Name)
      .map(toStack),
  };
}

/**
 * Pull the stack's repository and redeploy it. Portainer answers when the
 * deploy is done. Its environment variables are sent back as they are, so
 * an older Portainer that replaces them with the payload keeps them.
 */
export async function redeployPortainerStack(
  cfg: PortainerConfig,
  id: string
): Promise<PortainerResult<null>> {
  const ids = parsePortainerId(id);
  if (!ids) return { ok: false, error: "Not a Portainer stack id." };
  const current = await call<RawStack>(cfg, "GET", `/stacks/${ids.stackId}`);
  if (!current.ok) return current;
  if (!current.data?.GitConfig?.URL)
    return {
      ok: false,
      error:
        "This Portainer stack is not deployed from a Git repository — Portainer has nothing to pull.",
    };
  const r = await call<unknown>(
    cfg,
    "PUT",
    `/stacks/${ids.stackId}/git/redeploy?endpointId=${ids.endpointId}`,
    {
      Env: current.data.Env ?? [],
      RepullImageAndRedeploy: false,
      Prune: false,
    },
    10 * 60 * 1000
  );
  return r.ok ? { ok: true, data: null } : r;
}

/** Restart the stack's containers (compose stacks). */
export async function restartPortainerStack(
  cfg: PortainerConfig,
  stack: Pick<PortainerStack, "endpointId" | "name" | "type">
): Promise<PortainerResult<null>> {
  if (stack.type !== "compose")
    return {
      ok: false,
      error: `Restarting a ${stack.type} stack from here is not supported — restart it in Portainer.`,
    };
  const filters = encodeURIComponent(
    JSON.stringify({
      label: [`com.docker.compose.project=${stack.name.toLowerCase()}`],
    })
  );
  const list = await call<Array<{ Id: string }>>(
    cfg,
    "GET",
    `/endpoints/${stack.endpointId}/docker/containers/json?all=1&filters=${filters}`
  );
  if (!list.ok) return list;
  const containers = Array.isArray(list.data) ? list.data : [];
  if (!containers.length)
    return { ok: false, error: "No containers of this stack were found." };
  for (const c of containers) {
    const r = await call<unknown>(
      cfg,
      "POST",
      `/endpoints/${stack.endpointId}/docker/containers/${encodeURIComponent(c.Id)}/restart`,
      undefined,
      120_000
    );
    if (!r.ok) return r;
  }
  return { ok: true, data: null };
}

/** The Portainer version — the connection test. */
export async function portainerVersion(
  cfg: PortainerConfig
): Promise<PortainerResult<string>> {
  // /system/version on 2.20+, /status on older ones; both need the token
  // only for the first, so the stack list proves the token instead.
  const stacks = await call<unknown>(cfg, "GET", "/stacks");
  if (!stacks.ok) return stacks;
  const v = await call<{ ServerVersion?: string; Version?: string }>(
    cfg,
    "GET",
    "/system/version"
  );
  return {
    ok: true,
    data: v.ok ? (v.data?.ServerVersion ?? v.data?.Version ?? "?") : "?",
  };
}

/**
 * The stack a container belongs to: compose containers are reported as
 * "<project>-<service>", swarm services as "<stack>_<service>".
 */
export function portainerOfContainer<T extends { name: string }>(
  container: { app?: string | null; name?: string | null },
  stacks: T[]
): T | null {
  const app = (container.app ?? "").toLowerCase();
  let best: T | null = null;
  for (const s of stacks) {
    const n = s.name.toLowerCase();
    if (
      (app.startsWith(`${n}-`) || app.startsWith(`${n}_`)) &&
      (!best || n.length > best.name.length)
    )
      best = s;
  }
  return best;
}

/** The stack's page in Portainer. */
export function portainerStackUrl(
  baseUrl: string,
  s: Pick<PortainerStack, "endpointId" | "stackId" | "name" | "type">
): string {
  const type = s.type === "swarm" ? 1 : s.type === "kubernetes" ? 3 : 2;
  return `${baseUrl.replace(/\/+$/, "")}/#!/${s.endpointId}/docker/stacks/${encodeURIComponent(s.name)}?id=${s.stackId}&type=${type}&regular=true`;
}
