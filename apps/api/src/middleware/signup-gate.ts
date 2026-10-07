import type { Context, Next } from "hono";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, user, invitation } from "db";
import { isCloud } from "../lib/cloud";

/**
 * Public registration is closed on a self-hosted instance: sign-up is only
 * allowed for someone who was invited to an organization, plus the very
 * first account so a fresh deployment can be bootstrapped. The cloud
 * (CLOUD_MODE=true) is open to everyone.
 *
 * This sits in front of Better Auth's sign-up route rather than inside the
 * library, so the policy is visible in one place and testable on its own.
 */
export async function signupGate(c: Context, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (c.req.method !== "POST" || !path.endsWith("/api/auth/sign-up/email")) {
    return next();
  }
  if (isCloud()) return next();

  let email: string | null = null;
  try {
    // Read the body without consuming it: the auth handler needs it too.
    const body = (await c.req.raw.clone().json()) as { email?: unknown };
    if (typeof body.email === "string") email = body.email.trim().toLowerCase();
  } catch {
    email = null;
  }
  if (!email) {
    // Better Auth's client surfaces `message`, so errors must use its shape
    // to reach the user instead of a generic "Sign up failed".
    return c.json(
      {
        code: "EMAIL_REQUIRED",
        message: "An email address is required to sign up.",
      },
      400
    );
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(user);
  if (count === 0) return next();

  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${email}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!pending) {
    return c.json(
      {
        code: "SIGNUP_INVITATION_ONLY",
        message:
          "Registration is invitation only. Ask an organization owner to invite this address.",
      },
      403
    );
  }
  return next();
}
