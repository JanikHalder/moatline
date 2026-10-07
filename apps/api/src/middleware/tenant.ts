import type { Context, Next } from "hono";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auth } from "../auth";
import { db, member, organization } from "db";

type AuthSession = typeof auth.$Infer.Session;

export type TenantVariables = {
  organizationId: string | null;
  user: AuthSession["user"] | null;
  session: AuthSession["session"] | null;
};

const DEMO_ORG_SLUG = "demo";
const allowDemoOrg =
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_DEMO_ORG === "true";

export async function tenantMiddleware(
  c: Context<{ Variables: TenantVariables }>,
  next: Next
) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
    let orgId =
      (session.session as { activeOrganizationId?: string } | null)
        ?.activeOrganizationId ?? null;
    if (!orgId && allowDemoOrg) {
      const [demoOrg] = await db
        .select()
        .from(organization)
        .where(eq(organization.slug, DEMO_ORG_SLUG))
        .limit(1);
      if (demoOrg) orgId = demoOrg.id;
    }
    c.set("organizationId", orgId);
    await next();
    return;
  }

  if (allowDemoOrg) {
    let [demoOrg] = await db
      .select()
      .from(organization)
      .where(eq(organization.slug, DEMO_ORG_SLUG))
      .limit(1);
    if (!demoOrg) {
      try {
        await db.insert(organization).values({
          id: randomUUID(),
          name: "Demo Organization",
          slug: DEMO_ORG_SLUG,
        });
      } catch {
        // concurrent insert or duplicate, ignore
      }
      [demoOrg] = await db
        .select()
        .from(organization)
        .where(eq(organization.slug, DEMO_ORG_SLUG))
        .limit(1);
    }
    if (demoOrg) {
      c.set("user", null);
      c.set("session", null);
      c.set("organizationId", demoOrg.id);
      await next();
      return;
    }
  }

  if (allowDemoOrg && process.env.NODE_ENV !== "production") {
    console.warn(
      "[tenant] No org set despite allowDemoOrg=true (no session, demo org lookup failed or missing)"
    );
  }
  c.set("user", null);
  c.set("session", null);
  c.set("organizationId", null);
  await next();
}

export function requireOrganization(
  c: Context<{ Variables: TenantVariables }>
): string | Response {
  const orgId = c.get("organizationId");
  if (!orgId) {
    return c.json(
      {
        error:
          "No active organization. Create or select an organization first.",
      },
      403
    );
  }
  return orgId;
}

/** A real signed-in session (the demo-org bypass does not count). */
export function requireSession(
  c: Context<{ Variables: TenantVariables }>
): string | Response {
  if (!c.get("session") || !c.get("user")) {
    return c.json({ error: "Authentication required" }, 401);
  }
  return requireOrganization(c);
}

/**
 * Owner/admin of the active organization. For actions that hand out access
 * (agent tokens, accounts) or change what runs unattended.
 */
export async function requireOrgAdmin(
  c: Context<{ Variables: TenantVariables }>,
  message = "Only an owner or admin can do this."
): Promise<string | Response> {
  const orgId = requireSession(c);
  if (orgId instanceof Response) return orgId;
  const userId = c.get("user")!.id;
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  if (!row || (row.role !== "owner" && row.role !== "admin")) {
    return c.json({ error: message }, 403);
  }
  // Admin actions hand out access to servers and change where secrets go:
  // a stolen password alone must not be enough. REQUIRE_ADMIN_2FA=false
  // turns this off (e.g. for a local instance).
  if (
    process.env.REQUIRE_ADMIN_2FA !== "false" &&
    !c.get("user")?.twoFactorEnabled
  ) {
    return c.json(
      {
        error:
          "Turn on two-factor authentication first (Account → Security) — owners and admins need it for this.",
        code: "TWO_FACTOR_REQUIRED",
      },
      403
    );
  }
  return orgId;
}
