import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db, servers } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { auditRaw } from "../lib/audit-log";
import { clientIp } from "../lib/client-ip";
import {
  bearerAgentToken,
  generateAgentToken,
  hashAgentToken,
  isEnrollmentCode,
} from "../lib/agent-token";
import {
  agentReportSchema,
  ingestReport,
  isFresh,
} from "../services/agent-report";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The agent script ships with the API (apps/api/agent/pc-agent.py). From the
 * bundle it sits one level up, from source two — look in both rather than
 * guessing which one is running.
 */
function locateAgentScript(): string | null {
  const candidates = [
    path.resolve(here, "../agent/pc-agent.py"),
    path.resolve(here, "../../agent/pc-agent.py"),
    path.resolve(process.cwd(), "apps/api/agent/pc-agent.py"),
    path.resolve(process.cwd(), "agent/pc-agent.py"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let cached: { body: string; sha256: string; mtimeMs: number } | null = null;

/**
 * The agent script and its checksum. Re-read when the file changes, so an
 * updated agent never ships with the previous version's checksum (which
 * would make every install abort with "checksum mismatch").
 */
export function agentScript(): { body: string; sha256: string } | null {
  const file = locateAgentScript();
  if (!file) return null;
  const mtimeMs = fs.statSync(file).mtimeMs;
  if (cached && cached.mtimeMs === mtimeMs) return cached;
  const body = fs.readFileSync(file, "utf8");
  cached = {
    body,
    mtimeMs,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
  return cached;
}

/**
 * Server setup scripts from the save-server repository, copied into the app
 * (`pnpm sync:server-scripts`) so servers can fetch them from here: the
 * repository is private, and this keeps one place to get everything from.
 */
export const SETUP_SCRIPTS = [
  "harden-server.sh",
  "auto-update.sh",
  "setup-github-runner.sh",
] as const;
export type SetupScript = (typeof SETUP_SCRIPTS)[number];

const scriptCache = new Map<
  string,
  { body: string; sha256: string; mtimeMs: number }
>();

export function setupScript(
  name: string
): { body: string; sha256: string } | null {
  if (!(SETUP_SCRIPTS as readonly string[]).includes(name)) return null;
  const candidates = [
    path.resolve(here, "../server-scripts", name),
    path.resolve(here, "../../server-scripts", name),
    path.resolve(process.cwd(), "apps/api/server-scripts", name),
    path.resolve(process.cwd(), "server-scripts", name),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return null;
  const mtimeMs = fs.statSync(file).mtimeMs;
  const hit = scriptCache.get(name);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  const body = fs.readFileSync(file, "utf8");
  const entry = {
    body,
    mtimeMs,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
  scriptCache.set(name, entry);
  return entry;
}

/** The version of the agent this API ships (VERSION = "x.y.z" in the script). */
export function bundledAgentVersion(): string | null {
  return agentScript()?.body.match(/^VERSION = "([^"]+)"/m)?.[1] ?? null;
}

export { isOlderVersion } from "../lib/version";

// Per-token budget on top of the global per-IP limit: the agent sends one
// report every five minutes plus a daily full one, so this is generous.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 20;
const reportCounts = new Map<string, { count: number; resetAt: number }>();

function overBudget(tokenHash: string): boolean {
  const now = Date.now();
  let entry = reportCounts.get(tokenHash);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    reportCounts.set(tokenHash, entry);
  }
  entry.count++;
  if (reportCounts.size > 10_000) {
    for (const [k, v] of reportCounts)
      if (now >= v.resetAt) reportCounts.delete(k);
  }
  return entry.count > MAX_REPORTS_PER_WINDOW;
}

/**
 * Public routes for the agents running on the servers. Nothing here uses the
 * browser session: the only credential accepted is a server's agent token,
 * and it can do exactly one thing — report about that server.
 */
/**
 * Addresses the agent tells CrowdSec never to ban: the hosts Moatline
 * scans from (Nuclei, the external port check). Without this, the first
 * Nuclei run gets the scanner banned and every later check reads "down".
 */
function scannerAllowlist(): string[] {
  return (process.env.SCANNER_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(s));
}

/**
 * The one-line installer: fetch the agent, check it against the checksum
 * baked in here, run its installer. `bash -s -- --enroll pce_…` passes the
 * arguments through.
 */
function bootstrapScript(base: string, sha256: string): string {
  return `#!/usr/bin/env bash
# Moatline – agent bootstrap.
# Downloads pc-agent.py from ${base}, verifies its SHA-256 and runs its installer.
# Read it first if you like: curl -fsSL ${base}/api/agent/install.sh
set -euo pipefail
BASE="${base}"
SHA256="${sha256}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root, e.g.: curl -fsSL $BASE/api/agent/install.sh | sudo bash -s -- --enroll <code>" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[pc-agent] installing python3 ..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q python3
  else echo "python3 is required." >&2; exit 1; fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$BASE/api/agent/pc-agent.py" -o "$TMP/pc-agent.py"
if ! echo "$SHA256  $TMP/pc-agent.py" | sha256sum -c - >/dev/null 2>&1; then
  echo "[pc-agent] checksum mismatch – refusing to run the downloaded agent." >&2
  exit 1
fi
python3 "$TMP/pc-agent.py" install --url "$BASE" "$@"
`;
}

const enrollSchema = z.object({
  code: z.string().max(100),
  hostname: z.string().max(255).optional(),
});

export const agentRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/install.sh", (c) => {
    const script = agentScript();
    if (!script)
      return c.text("echo 'Agent script not bundled' >&2; exit 1", 404);
    // The URL the script was fetched from is the one the server can reach.
    const base = (
      process.env.AGENT_BASE_URL || new URL(c.req.url).origin
    ).replace(/\/+$/, "");
    c.header("content-type", "text/x-shellscript; charset=utf-8");
    c.header("cache-control", "no-store");
    return c.body(bootstrapScript(base, script.sha256));
  })
  .post("/enroll", bodyLimit({ maxSize: 4096 }), async (c) => {
    const parsed = enrollSchema.safeParse(await c.req.json().catch(() => null));
    // One generic answer for every failure: nothing to learn by probing.
    const denied = () =>
      c.json(
        {
          error:
            "Install code invalid, expired or already used. Generate a new install command in Moatline.",
        },
        401
      );
    if (!parsed.success || !isEnrollmentCode(parsed.data.code)) return denied();
    const hash = hashAgentToken(parsed.data.code);
    const t = generateAgentToken();
    // Consume the code and set the token in one statement, so the same
    // code can never be redeemed twice, even by two requests at once.
    const [server] = await db
      .update(servers)
      .set({
        enrollmentCodeHash: null,
        enrollmentExpiresAt: null,
        agentTokenHash: t.hash,
        agentTokenPrefix: t.prefix,
        agentTokenCreatedAt: new Date(),
      })
      .where(
        and(
          eq(servers.enrollmentCodeHash, hash),
          gt(servers.enrollmentExpiresAt, new Date())
        )
      )
      .returning({
        id: servers.id,
        name: servers.name,
        organizationId: servers.organizationId,
      });
    if (!server) return denied();
    await auditRaw({
      organizationId: server.organizationId,
      action: "server.enrolled",
      ip: clientIp(c),
      detail: {
        server: server.name,
        serverId: server.id,
        hostname: parsed.data.hostname ?? null,
      },
    });
    console.log(
      `[agent] server ${server.name} (${server.id}) enrolled${parsed.data.hostname ? ` from host ${parsed.data.hostname}` : ""}`
    );
    return c.json({
      token: t.token,
      serverName: server.name,
      crowdsecAllowlist: scannerAllowlist(),
    });
  })
  .get("/pc-agent.py", (c) => {
    const script = agentScript();
    if (!script) return c.json({ error: "Agent script not bundled" }, 404);
    c.header("content-type", "text/x-python; charset=utf-8");
    c.header("x-content-sha256", script.sha256);
    c.header("cache-control", "no-store");
    return c.body(script.body);
  })
  .get("/scripts/:name", (c) => {
    const script = setupScript(c.req.param("name"));
    if (!script) return c.text("echo 'Unknown script' >&2; exit 1", 404);
    c.header("content-type", "text/x-shellscript; charset=utf-8");
    c.header("x-content-sha256", script.sha256);
    c.header("cache-control", "no-store");
    return c.body(script.body);
  })
  .get("/pc-agent.py.sha256", (c) => {
    const script = agentScript();
    if (!script) return c.json({ error: "Agent script not bundled" }, 404);
    return c.text(`${script.sha256}  pc-agent.py\n`);
  })
  .post(
    "/report",
    bodyLimit({
      maxSize: 8 * 1024 * 1024,
      onError: (c) => c.json({ error: "Report too large" }, 413),
    }),
    async (c) => {
      const token = bearerAgentToken(c.req.header("authorization"));
      if (!token) return c.json({ error: "Agent token required" }, 401);
      const tokenHash = hashAgentToken(token);
      if (overBudget(tokenHash)) {
        return c.json({ error: "Too many reports" }, 429);
      }
      const [server] = await db
        .select()
        .from(servers)
        .where(eq(servers.agentTokenHash, tokenHash))
        .limit(1);
      // Same answer for "no such token" and "revoked": nothing to probe.
      if (!server) return c.json({ error: "Invalid agent token" }, 401);

      let json: unknown;
      try {
        json = await c.req.json();
      } catch {
        return c.json({ error: "Body is not JSON" }, 400);
      }
      const parsed = agentReportSchema.safeParse(json);
      if (!parsed.success) {
        return c.json(
          {
            error: "Report does not match the expected format",
            issues: parsed.error.issues.slice(0, 5).map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          400
        );
      }
      if (!isFresh(parsed.data.sentAt)) {
        return c.json(
          {
            error:
              "Report timestamp is more than 15 minutes off — check the server clock (timedatectl).",
          },
          400
        );
      }
      await ingestReport(server, parsed.data);
      // What the agent should check on its next run (declarative: paths to
      // stat, nothing to execute).
      return c.json({
        ok: true,
        checks: {
          backups: server.backupChecks ?? [],
          storage: (server.storageChecks ?? [])
            .filter((c) => c.path)
            .map((c) => ({ name: c.name, path: c.path })),
        },
      });
    }
  );
