import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomInt, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, member, user } from "db";
import { auth } from "../auth";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin } from "../middleware/tenant";
import { audit } from "../lib/audit-log";

/**
 * Ambiguous glyphs (0/O, 1/l/I) are left out: this password is read off a
 * screen and typed into a chat window by hand.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_LENGTH = 20;

function generatePassword(): string {
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

const createMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().max(100).optional(),
  role: z.enum(["member", "admin", "owner"]).default("member"),
});

/**
 * Creating an account for someone else is an owner/admin action — a plain
 * member must not be able to mint logins into the organization.
 */
const ADMIN_ONLY = "Only an owner or admin can add members directly.";

export const membersRouter = new Hono<{ Variables: TenantVariables }>().post(
  "/",
  zValidator("json", createMemberSchema),
  async (c) => {
    const orgId = await requireOrgAdmin(c, ADMIN_ONLY);
    if (orgId instanceof Response) return orgId;

    const body = c.req.valid("json");
    const email = body.email.trim().toLowerCase();
    const name = body.name?.trim() || email.split("@")[0] || "User";

    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${email}`)
      .limit(1);

    // Someone who already has a login just gets added to the organization —
    // never reset an existing account's password from here.
    if (existing) {
      const [alreadyMember] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, orgId), eq(member.userId, existing.id))
        )
        .limit(1);
      if (alreadyMember) {
        return c.json(
          { error: "That address is already a member of this organization." },
          409
        );
      }
      await db.insert(member).values({
        id: randomUUID(),
        userId: existing.id,
        organizationId: orgId,
        role: body.role,
      });
      await audit(
        c,
        "member.add",
        { type: "user", id: existing.id, name: email },
        {
          role: body.role,
        }
      );
      return c.json({ created: false, email, password: null }, 201);
    }

    const password = generatePassword();
    try {
      // Server-side call on purpose: it bypasses the invitation-only signup
      // gate (which guards the public HTTP route), and the session Better Auth
      // creates here is simply not forwarded to the caller.
      await auth.api.signUpEmail({
        body: { email, password, name },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create user";
      return c.json({ error: message }, 400);
    }

    const [created] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${email}`)
      .limit(1);
    if (!created) {
      return c.json({ error: "User was not created." }, 500);
    }

    await db.insert(member).values({
      id: randomUUID(),
      userId: created.id,
      organizationId: orgId,
      role: body.role,
    });

    await audit(
      c,
      "member.create",
      { type: "user", id: created.id, name: email },
      {
        role: body.role,
      }
    );
    // The password is returned exactly once — it is stored only as a hash.
    return c.json({ created: true, email, password }, 201);
  }
);
