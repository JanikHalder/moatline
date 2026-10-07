import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, organization, orgIntegrations } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin, requireSession } from "../middleware/tenant";
import { decryptSecret, encryptSecret, isEncrypted } from "../lib/crypto";
import {
  appManifest,
  convertManifest,
  listInstallations,
  manifestAction,
} from "../lib/github-app";
import { audit } from "../lib/audit-log";

/**
 * Create the organization's GitHub App from Settings, the way Dokploy does:
 * the browser posts a manifest to GitHub, GitHub redirects back with a code
 * that turns into the app's credentials, then the app is installed on an
 * account or organization and GitHub sends the browser back once more.
 */

const STATE_TTL_MS = 60 * 60 * 1000;

/** The web app's public URL: GitHub sends the browser there. */
function appUrl(c: Context): string {
  return (process.env.APP_URL || new URL(c.req.url).origin).replace(/\/+$/, "");
}

const back = (c: Context, query: string) =>
  c.redirect(`${appUrl(c)}/settings?${query}`, 302);

async function readRow(orgId: string) {
  const [row] = await db
    .select({
      githubApp: orgIntegrations.githubApp,
      githubAppState: orgIntegrations.githubAppState,
    })
    .from(orgIntegrations)
    .where(eq(orgIntegrations.organizationId, orgId));
  return row;
}

async function saveState(orgId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const githubAppState = `${token}.${Date.now()}`;
  await db
    .insert(orgIntegrations)
    .values({ organizationId: orgId, githubAppState })
    .onConflictDoUpdate({
      target: orgIntegrations.organizationId,
      set: { githubAppState },
    });
  return token;
}

/** The state GitHub brought back is the one this organization started. */
function stateMatches(stored: string | null | undefined, given: string) {
  if (!stored || !given) return false;
  const [token, at] = stored.split(".");
  return token === given && Date.now() - Number(at) < STATE_TTL_MS;
}

const plain = (v: string) => (isEncrypted(v) ? decryptSecret(v) : v);

export const githubAppRouter = new Hono<{ Variables: TenantVariables }>()
  // The manifest and where to post it. A form post from the browser, not a
  // request from here: GitHub has to show the app to a signed-in person.
  .post(
    "/manifest",
    zValidator(
      "json",
      z.object({
        githubOrg: z
          .string()
          .max(39)
          .regex(/^[A-Za-z0-9-]*$/)
          .optional(),
      })
    ),
    async (c) => {
      const orgId = await requireOrgAdmin(
        c,
        "Only an owner or admin can connect GitHub."
      );
      if (orgId instanceof Response) return orgId;
      const { githubOrg } = c.req.valid("json");
      const [org] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, orgId));
      const state = await saveState(orgId);
      // App names are unique on GitHub: a short suffix avoids a clash.
      const name = `Moatline ${(org?.name ?? "").slice(0, 20)}`
        .trim()
        .concat(` ${randomBytes(2).toString("hex")}`)
        .slice(0, 34);
      return c.json({
        action: manifestAction(state, githubOrg),
        manifest: appManifest({ appUrl: appUrl(c), name }),
      });
    }
  )
  // GitHub created the app: fetch its credentials, then go install it.
  .get("/callback", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return back(c, "githubApp=signin");
    const code = c.req.query("code") ?? "";
    const row = await readRow(orgId);
    if (!stateMatches(row?.githubAppState, c.req.query("state") ?? ""))
      return back(c, "githubApp=expired");
    const r = await convertManifest(code);
    if (!r.ok) {
      console.error("[github-app] manifest conversion failed:", r.error);
      return back(c, "githubApp=failed");
    }
    const a = r.app;
    const state = await saveState(orgId);
    await db
      .update(orgIntegrations)
      .set({
        githubApp: {
          id: a.id,
          slug: a.slug,
          name: a.name,
          htmlUrl: a.htmlUrl,
          clientId: a.clientId,
          clientSecret: encryptSecret(a.clientSecret),
          privateKey: encryptSecret(a.privateKey),
          webhookSecret: a.webhookSecret
            ? encryptSecret(a.webhookSecret)
            : null,
          installations: [],
        },
        updatedAt: new Date(),
      })
      .where(eq(orgIntegrations.organizationId, orgId));
    await audit(
      c,
      "integrations.github_app_create",
      { type: "organization", id: orgId },
      { app: a.slug }
    );
    return c.redirect(
      `https://github.com/apps/${encodeURIComponent(a.slug)}/installations/new?state=${encodeURIComponent(state)}`,
      302
    );
  })
  // Installed (or its repositories changed): ask GitHub where, rather than
  // trusting the installation id in the URL.
  .get("/installed", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return back(c, "githubApp=signin");
    const row = await readRow(orgId);
    if (!row?.githubApp) return back(c, "githubApp=missing");
    const app = row.githubApp;
    const list = await listInstallations({
      id: app.id,
      privateKey: plain(app.privateKey),
    });
    if (!list.ok) return back(c, "githubApp=failed");
    await db
      .update(orgIntegrations)
      .set({
        githubApp: { ...app, installations: list.list },
        githubAppState: null,
        updatedAt: new Date(),
      })
      .where(eq(orgIntegrations.organizationId, orgId));
    return back(c, "githubApp=installed");
  })
  // Read the installations again (after installing on another account).
  .post("/refresh", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const row = await readRow(orgId);
    if (!row?.githubApp) return c.json({ error: "No GitHub App." }, 404);
    const app = row.githubApp;
    const list = await listInstallations({
      id: app.id,
      privateKey: plain(app.privateKey),
    });
    if (!list.ok) return c.json({ error: list.error }, 502);
    await db
      .update(orgIntegrations)
      .set({ githubApp: { ...app, installations: list.list } })
      .where(eq(orgIntegrations.organizationId, orgId));
    return c.json({ installations: list.list });
  })
  // Forget the app here. Deleting it on GitHub is the owner's step.
  .delete("/", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can disconnect GitHub."
    );
    if (orgId instanceof Response) return orgId;
    const row = await readRow(orgId);
    if (!row?.githubApp) return c.json({ error: "No GitHub App." }, 404);
    await db
      .update(orgIntegrations)
      .set({ githubApp: null, githubAppState: null, updatedAt: new Date() })
      .where(eq(orgIntegrations.organizationId, orgId));
    await audit(
      c,
      "integrations.github_app_remove",
      { type: "organization", id: orgId },
      { app: row.githubApp.slug }
    );
    // GitHub keeps the app until its owner deletes it there.
    return c.json({ ok: true, htmlUrl: row.githubApp.htmlUrl });
  });
