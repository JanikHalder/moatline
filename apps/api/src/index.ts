import "./load-env";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { app } from "./app";
import { auth } from "./auth";
import { db, organization } from "db";
import { startScheduler } from "./services/scheduler";

console.log("[api] Starting...");
if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}
const isProd = process.env.NODE_ENV === "production";
if (isProd) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    console.error(
      "BETTER_AUTH_SECRET must be at least 32 characters in production"
    );
    process.exit(1);
  }
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin || !corsOrigin.trim()) {
    console.error(
      "CORS_ORIGIN must be set in production (comma-separated for multiple origins)"
    );
    process.exit(1);
  }
}

async function start() {
  console.log("[api] Loading auth config...");
  const authWithContext = auth as {
    $context: Promise<{
      options: { emailAndPassword?: { enabled?: boolean } };
    }>;
  };
  try {
    const ctx = await authWithContext.$context;
    const enabled = ctx.options?.emailAndPassword?.enabled;
    console.log(
      `[api] Auth: emailAndPassword.enabled = ${String(enabled ?? "undefined")}`
    );
    if (!enabled) {
      console.warn(
        "[api] Sign-in/sign-up with email and password will fail. Set emailAndPassword.enabled to true in auth.ts and restart."
      );
    }
  } catch (e) {
    console.error("[api] Failed to read auth config:", e);
  }

  const allowDemoOrg =
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEMO_ORG === "true";
  console.log(
    `[api] Demo org allowed (no login): ${allowDemoOrg} (NODE_ENV=${process.env.NODE_ENV ?? "undefined"}, ENABLE_DEMO_ORG=${process.env.ENABLE_DEMO_ORG ?? "undefined"})`
  );
  try {
    const [demoOrg] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, "demo"))
      .limit(1);
    console.log(
      `[api] Demo org in DB: ${demoOrg ? "yes (id=" + demoOrg.id + ")" : "NO – run: pnpm --filter api seed:demo-org"}`
    );
  } catch (e) {
    console.warn("[api] Could not check demo org:", e);
  }
  if (process.env.GITHUB_TOKEN) {
    console.log(
      "[api] GITHUB_TOKEN set – used for organizations that have no token of their own."
    );
  } else {
    console.log(
      "[api] GITHUB_TOKEN not set – organizations need their own token under Settings, otherwise only public repos can be scanned and auto-fix stays disabled."
    );
  }
  if (!process.env.SECRETS_KEY) {
    console.warn(
      "[api] SECRETS_KEY not set – saving org integrations (Dokploy/Telegram/SMTP secrets) will fail until it is set."
    );
  }

  const port = Number(process.env.PORT) || 3001;
  const server = serve({ fetch: app.fetch, port });
  server.on("listening", () => {
    console.log(`API running at http://localhost:${port}`);
    startScheduler();
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[api] Port ${port} is already in use. Stop the other process (e.g. lsof -i :${port}) or set PORT to another number.`
      );
    } else {
      console.error("[api]", err);
    }
    process.exit(1);
  });
}

start();
