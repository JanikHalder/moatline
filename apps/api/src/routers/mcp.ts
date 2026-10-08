import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db, apiKeys } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { bearerApiKey, hashAgentToken } from "../lib/agent-token";
import { auditRaw } from "../lib/audit-log";
import { clientIp } from "../lib/client-ip";
import { buildCommit } from "../lib/build-info";
import {
  loadMcpPolicy,
  MCP_TOOLS,
  type McpAccess,
} from "../services/mcp-tools";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const INSTRUCTIONS =
  "Moatline watches this organization's servers (load, updates, CrowdSec, Trivy, Docker apps, backups, open ports), its applications (CVEs in the deployed commit vs. the branch, Nuclei findings on live URLs) and Uptime Kuma monitors. Start with get_overview. Use get_findings_report for a markdown task list a coding agent can work through. start_security_fix (fix scope) opens a lockfile-only PR. Findings with fixesItselfAt are handled by the server's automatic updates. API keys may be limited to specific repositories and servers.";

const calls = new Map<string, { count: number; resetAt: number }>();
function overBudget(keyId: string): boolean {
  const now = Date.now();
  let e = calls.get(keyId);
  if (!e || now >= e.resetAt) {
    e = { count: 0, resetAt: now + 60_000 };
    calls.set(keyId, e);
  }
  return ++e.count > 120;
}

const ok = (id: JsonRpcRequest["id"], result: unknown) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  result,
});
const fail = (id: JsonRpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

/**
 * MCP over Streamable HTTP, stateless: every POST carries a JSON-RPC message
 * and gets a JSON answer — no sessions, no server-sent events. Authenticated
 * with an organization API key (Settings → API keys); the browser session is
 * never accepted here.
 */
export const mcpRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", (c) =>
    c.json(
      { error: "Use POST with a JSON-RPC message (MCP Streamable HTTP)." },
      405
    )
  )
  .delete("/", (c) => c.body(null, 405))
  .post(
    "/",
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => c.json(fail(null, -32600, "Request too large"), 413),
    }),
    async (c) => {
      const raw = bearerApiKey(c.req.header("authorization"));
      if (!raw) {
        c.header("www-authenticate", 'Bearer realm="moatline"');
        return c.json(
          { error: "API key required (Authorization: Bearer pck_…)" },
          401
        );
      }
      const [key] = await db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.keyHash, hashAgentToken(raw)),
            isNull(apiKeys.revokedAt),
            or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))
          )
        )
        .limit(1);
      if (!key)
        return c.json({ error: "Invalid, revoked or expired API key" }, 401);
      if (overBudget(key.id)) {
        return c.json(fail(null, -32000, "Too many requests"), 429);
      }
      void db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, key.id))
        .catch(() => {});

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(fail(null, -32700, "Parse error"), 400);
      }
      const batch = Array.isArray(body);
      const messages = (batch ? body : [body]) as JsonRpcRequest[];
      const answers = [];
      for (const msg of messages.slice(0, 20)) {
        if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
          answers.push(fail(msg?.id, -32600, "Invalid request"));
          continue;
        }
        const isNotification = msg.id === undefined;
        const res = await handle(msg, key, c);
        if (!isNotification && res) answers.push(res);
      }
      if (answers.length === 0) return c.body(null, 202);
      return c.json(batch ? answers : answers[0]);
    }
  );

async function handle(
  msg: JsonRpcRequest,
  key: typeof apiKeys.$inferSelect,
  c: Parameters<typeof clientIp>[0]
) {
  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "moatline",
          version: buildCommit()?.slice(0, 7) ?? "dev",
        },
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: MCP_TOOLS.filter(
          (t) => t.scope === "read" || key.scopes.includes(t.scope)
        ).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.scope === "read" },
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      if (tool.scope !== "read" && !key.scopes.includes(tool.scope)) {
        return ok(msg.id, {
          isError: true,
          content: [
            {
              type: "text",
              text: `This API key cannot run ${name}; it needs the "${tool.scope}" permission.`,
            },
          ],
        });
      }
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const policy = await loadMcpPolicy(key.organizationId);
      const access: McpAccess = {
        allowedRepoIds: key.allowedRepoIds ?? null,
        allowedServerIds: key.allowedServerIds ?? null,
        policy,
        apiKeyName: key.name,
      };
      try {
        const result = await tool.run(key.organizationId, args, access);
        await auditRaw({
          organizationId: key.organizationId,
          action: `mcp.${name}`,
          userEmail: `mcp:${key.name}`,
          ip: clientIp(c),
          detail: {
            apiKey: key.name,
            arguments: args,
            outcome: "ok",
            source: "mcp",
          },
        });
        if (name === "start_security_fix" && result && typeof result === "object") {
          const r = result as {
            started?: boolean;
            repository?: string;
            runId?: string;
          };
          if (r.started) {
            await auditRaw({
              organizationId: key.organizationId,
              action: "security_fix.started",
              userEmail: `mcp:${key.name}`,
              target: {
                type: "repository",
                name: r.repository ?? null,
              },
              ip: clientIp(c),
              detail: {
                source: "mcp",
                apiKey: key.name,
                runId: r.runId,
              },
            });
          }
        }
        return ok(msg.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 1) }],
          structuredContent: Array.isArray(result) ? { items: result } : result,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await auditRaw({
          organizationId: key.organizationId,
          action: `mcp.${name}`,
          userEmail: `mcp:${key.name}`,
          ip: clientIp(c),
          detail: {
            apiKey: key.name,
            arguments: args,
            outcome: "error",
            error: message.slice(0, 500),
            source: "mcp",
          },
        });
        return ok(msg.id, {
          isError: true,
          content: [{ type: "text", text: message }],
        });
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
