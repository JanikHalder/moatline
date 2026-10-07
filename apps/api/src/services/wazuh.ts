import https from "node:https";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, orgIntegrations, servers } from "db";
import { decryptSecret, isEncrypted } from "../lib/crypto";
import { validateLiveUrl } from "../lib/live-check";
import { syncAndNotify, type FindingInput } from "../lib/server-findings";

export type WazuhConfig = {
  apiUrl: string;
  user: string;
  password: string;
  /** PEM. When set, it is the only CA trusted for the manager. */
  ca: string | null;
};

export type WazuhAgent = {
  id: string;
  name: string | null;
  status: string | null;
  version: string | null;
  os: string | null;
  lastKeepAlive: string | null;
};

export type WazuhScaPolicy = {
  policyId: string;
  name: string;
  pass: number;
  fail: number;
  score: number | null;
  endScan: string | null;
};

const MAX_BODY = 5 * 1024 * 1024;

/**
 * One JSON request to the manager. Plain node:https because the manager
 * usually runs with a self-signed certificate: instead of turning off
 * verification (the common, wrong fix), the operator pastes the manager's CA
 * and exactly that CA is trusted.
 */
function request<T>(
  config: WazuhConfig,
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>,
  timeoutMs = 15_000
): Promise<{ status: number; body: T | null }> {
  const url = new URL(path, config.apiUrl.replace(/\/+$/, "") + "/");
  if (url.protocol !== "https:") {
    return Promise.reject(
      new Error("The Wazuh API must be reached over https.")
    );
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: { accept: "application/json", ...headers },
        ca: config.ca ?? undefined,
        timeout: timeoutMs,
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy(new Error("Wazuh response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: T | null = null;
          try {
            body = text ? (JSON.parse(text) as T) : null;
          } catch {
            body = null;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      }
    );
    req.on("timeout", () =>
      req.destroy(new Error(`Wazuh did not answer within ${timeoutMs / 1000}s`))
    );
    req.on("error", reject);
    req.end();
  });
}

async function authenticate(config: WazuhConfig): Promise<string> {
  const basic = Buffer.from(`${config.user}:${config.password}`).toString(
    "base64"
  );
  const res = await request<{ data?: { token?: string } }>(
    config,
    "POST",
    "security/user/authenticate",
    { authorization: `Basic ${basic}` }
  );
  if (res.status === 401) throw new Error("Wazuh rejected the credentials.");
  const token = res.body?.data?.token;
  if (!token) throw new Error(`Wazuh login failed (HTTP ${res.status}).`);
  return token;
}

type Affected<T> = { data?: { affected_items?: T[] } };

export async function fetchWazuhAgent(
  config: WazuhConfig,
  token: string,
  agentId: string
): Promise<{ agent: WazuhAgent | null; sca: WazuhScaPolicy[] }> {
  const id = encodeURIComponent(agentId);
  const auth = { authorization: `Bearer ${token}` };
  const agents = await request<
    Affected<{
      id: string;
      name?: string;
      status?: string;
      version?: string;
      os?: { name?: string; version?: string };
      lastKeepAlive?: string;
    }>
  >(config, "GET", `agents?agents_list=${id}`, auth);
  const a = agents.body?.data?.affected_items?.[0];
  const sca = await request<
    Affected<{
      policy_id: string;
      name: string;
      pass?: number;
      fail?: number;
      score?: number;
      end_scan?: string;
    }>
  >(config, "GET", `sca/${id}`, auth);
  return {
    agent: a
      ? {
          id: a.id,
          name: a.name ?? null,
          status: a.status ?? null,
          version: a.version ?? null,
          os: a.os ? [a.os.name, a.os.version].filter(Boolean).join(" ") : null,
          lastKeepAlive: a.lastKeepAlive ?? null,
        }
      : null,
    sca: (sca.body?.data?.affected_items ?? []).map((p) => ({
      policyId: p.policy_id,
      name: p.name,
      pass: p.pass ?? 0,
      fail: p.fail ?? 0,
      score: typeof p.score === "number" ? p.score : null,
      endScan: p.end_scan ?? null,
    })),
  };
}

export function wazuhFindings(
  agentId: string,
  agent: WazuhAgent | null,
  sca: WazuhScaPolicy[]
): FindingInput[] {
  if (!agent) {
    return [
      {
        fingerprint: "agent-missing",
        severity: "high",
        title: `Wazuh agent ${agentId} does not exist on the manager`,
        detail: "Check the agent ID in the server settings.",
      },
    ];
  }
  const out: FindingInput[] = [];
  if (agent.status && agent.status !== "active") {
    out.push({
      fingerprint: "agent-status",
      severity: "high",
      title: `Wazuh agent is ${agent.status.replace(/_/g, " ")}`,
      detail: agent.lastKeepAlive
        ? `Last keep-alive ${agent.lastKeepAlive}. Events from this server are not being analysed.`
        : "Events from this server are not being analysed.",
    });
  }
  for (const p of sca) {
    if (p.score == null || p.score >= 80) continue;
    out.push({
      fingerprint: `sca:${p.policyId}`,
      severity: p.score < 50 ? "medium" : "low",
      title: `Hardening check "${p.name}": ${p.score}% (${p.fail} failed)`,
      detail:
        "Wazuh Security Configuration Assessment. The failed checks are listed in the Wazuh dashboard under the agent's SCA tab.",
      target: p.policyId,
    });
  }
  return out;
}

export async function resolveWazuhConfig(
  orgId: string
): Promise<WazuhConfig | null> {
  const [integ] = await db
    .select()
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId))
    .limit(1);
  if (!integ?.wazuhApiUrl || !integ.wazuhUser || !integ.wazuhPassword)
    return null;
  try {
    return {
      apiUrl: integ.wazuhApiUrl,
      user: integ.wazuhUser,
      password: isEncrypted(integ.wazuhPassword)
        ? decryptSecret(integ.wazuhPassword)
        : integ.wazuhPassword,
      ca: integ.wazuhCaCert?.trim() || null,
    };
  } catch {
    return null;
  }
}

export async function syncWazuhForOrg(orgId: string): Promise<void> {
  const config = await resolveWazuhConfig(orgId);
  if (!config) return;
  const targets = await db
    .select()
    .from(servers)
    .where(
      and(eq(servers.organizationId, orgId), isNotNull(servers.wazuhAgentId))
    );
  if (targets.length === 0) return;

  const markError = async (error: string) => {
    for (const s of targets) {
      const prev = (s.wazuhState ?? {}) as Record<string, unknown>;
      await db
        .update(servers)
        .set({
          wazuhState: { ...prev, error, errorAt: new Date().toISOString() },
        })
        .where(eq(servers.id, s.id));
    }
  };

  const valid = validateLiveUrl(config.apiUrl);
  if (!valid.ok) return markError(valid.reason);
  let token: string;
  try {
    token = await authenticate(config);
  } catch (e) {
    return markError(e instanceof Error ? e.message : String(e));
  }

  for (const s of targets) {
    const agentId = s.wazuhAgentId!.trim();
    try {
      const { agent, sca } = await fetchWazuhAgent(config, token, agentId);
      await db
        .update(servers)
        .set({
          wazuhState: {
            checkedAt: new Date().toISOString(),
            error: null,
            agent,
            sca,
          },
        })
        .where(eq(servers.id, s.id));
      await syncAndNotify(s.id, "wazuh", wazuhFindings(agentId, agent, sca));
    } catch (e) {
      const prev = (s.wazuhState ?? {}) as Record<string, unknown>;
      await db
        .update(servers)
        .set({
          wazuhState: {
            ...prev,
            error: e instanceof Error ? e.message : String(e),
            errorAt: new Date().toISOString(),
          },
        })
        .where(eq(servers.id, s.id));
    }
  }
}
