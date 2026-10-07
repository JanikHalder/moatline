import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { auth } from "./auth";
import { tenantMiddleware } from "./middleware/tenant";
import { securityHeaders } from "./middleware/security-headers";
import { rateLimit } from "./middleware/rate-limit";
import { signupGate } from "./middleware/signup-gate";
import { loginThrottle } from "./middleware/login-throttle";
import type { TenantVariables } from "./middleware/tenant";
import { reposRouter } from "./routers/repos";
import { scansRouter } from "./routers/scans";
import { gitRouter } from "./routers/git";
import { githubAppRouter } from "./routers/github-app";
import { probeRouter } from "./routers/probe";
import { maintenanceRouter } from "./routers/maintenance";
import { platformWatchRouter } from "./routers/platform-watch";
import { cronChecksRouter, pingRouter } from "./routers/cron-checks";
import { publicStatusRouter, statusPagesRouter } from "./routers/status-pages";
import { packagesRouter } from "./routers/packages";
import { updateRunsRouter } from "./routers/update-runs";
import { dashboardRouter } from "./routers/dashboard";
import { observabilityRouter, orgSettingsRouter } from "./routers/org-settings";
import { deployRunsRouter } from "./routers/deploy-runs";
import { systemRouter } from "./routers/system";
import { operatorRouter } from "./routers/operator";
import { membersRouter } from "./routers/members";
import { serversRouter } from "./routers/servers";
import { agentRouter } from "./routers/agent";
import { monitoringRouter } from "./routers/monitoring";
import { auditRouter } from "./routers/audit";
import { mcpRouter } from "./routers/mcp";
import { apiKeysRouter } from "./routers/api-keys";
import { clientsRouter, domainsRouter } from "./routers/clients";
import { provisionRouter } from "./routers/provision";
import { billingRouter } from "./routers/billing";
import { alertsRouter } from "./routers/alerts";
import { buildCommit, startedAt } from "./lib/build-info";
import { getSchedulerStatus } from "./services/scheduler";

const isProd = process.env.NODE_ENV === "production";
const allowedOrigins = isProd
  ? (process.env.CORS_ORIGIN ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : [process.env.CORS_ORIGIN ?? "http://localhost:5173"];

function corsOrigin(origin: string | null): string | null {
  if (!origin) return allowedOrigins[0] ?? null;
  if (allowedOrigins.includes(origin)) return origin;
  if (!isProd && origin.startsWith("http://localhost")) return origin;
  return null;
}

export const app = new Hono<{ Variables: TenantVariables }>();

app.onError((err, c) => {
  console.error(err);
  const status = err.message?.includes("not found") ? 404 : 500;
  return c.json({ error: err.message ?? "Internal server error" }, status);
});

app.use("*", securityHeaders);
app.use("*", rateLimit);
app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowHeaders: ["Content-Type", "Authorization", "X-Use-Demo-Org"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

app.use("*", tenantMiddleware);

app.use("/api/auth/*", loginThrottle);
app.use("/api/auth/*", signupGate);

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.route("/api/repos", reposRouter);
app.route("/api/git", gitRouter);
app.route("/api/github-app", githubAppRouter);
// Checks from other locations; the probe token is the credential.
app.route("/api/probe", probeRouter);
app.route("/api/cron-checks", cronChecksRouter);
app.route("/api/maintenance", maintenanceRouter);
app.route("/api/platform-watch", platformWatchRouter);
// Scheduled jobs report in here; the token in the URL is the credential.
app.route("/api/ping", pingRouter);
app.route("/api/status-pages", statusPagesRouter);
// Published status pages are public on purpose.
app.route("/api/public/status", publicStatusRouter);
app.route("/api/scans", scansRouter);
app.route("/api/packages", packagesRouter);
app.route("/api/update-runs", updateRunsRouter);
app.route("/api/dashboard", dashboardRouter);
app.route("/api/org/integrations", orgSettingsRouter);
app.route("/api/org/observability", observabilityRouter);
app.route("/api/deploy-runs", deployRunsRouter);
app.route("/api/system", systemRouter);
// Figures across all organizations, for OPERATOR_EMAILS only.
app.route("/api/operator", operatorRouter);
app.route("/api/org/members", membersRouter);
app.route("/api/servers", serversRouter);
app.route("/api/clients", clientsRouter);
app.route("/api/provision", provisionRouter);
// Cloud billing; its webhook is authenticated by Stripe's signature.
app.route("/api/billing", billingRouter);
// Alerts from observability tools; the token in the URL is the credential.
app.route("/api/alerts", alertsRouter);
app.route("/api/domains", domainsRouter);
app.route("/api/monitoring", monitoringRouter);
app.route("/api/org/audit", auditRouter);
app.route("/api/org/api-keys", apiKeysRouter);
// MCP for AI assistants, authenticated by organization API key only.
app.route("/api/mcp", mcpRouter);
// Called by the agents on the servers, authenticated by agent token only.
app.route("/api/agent", agentRouter);

/**
 * Public, unauthenticated, and deliberately more than `{ ok: true }`: this is
 * what a deployment can be asked about from the outside. `commit` is what makes
 * "is the fix live?" answerable — the repository live-check reads exactly this
 * field on other deployments too. `scheduler` shows whether scheduled scans run
 * in *this* process, which is otherwise invisible across several instances.
 *
 * Nothing here identifies users or the organizations on the instance.
 */
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    commit: buildCommit(),
    startedAt,
    scheduler: getSchedulerStatus().enabled,
  })
);

/**
 * Serve the built web app from the API when it is present, so a single-service
 * deployment (one domain, no CORS, no build-time API URL) works without a
 * separate static server. Deployments that put nginx or a second service in
 * front simply have no dist directory here and skip all of this.
 */
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist"
);

if (fs.existsSync(path.join(webDist, "index.html"))) {
  const root = path.relative(process.cwd(), webDist) || ".";
  app.use("/assets/*", serveStatic({ root }));
  app.get("/favicon.ico", serveStatic({ root, path: "favicon.ico" }));
  // Everything that is not an API route falls back to index.html so the
  // client-side router owns deep links such as /accept-invitation/<id>.
  app.get("*", (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return serveStatic({ root, path: "index.html" })(c, next);
  });
  console.log(`[api] Serving the web build from ${webDist}`);
} else {
  console.log(
    "[api] No web build found – serving the API only (a separate web service or nginx is expected)."
  );
}
