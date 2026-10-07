import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, auditLog, member, user } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin } from "../middleware/tenant";

/**
 * The organization's audit trail, newest first. Account events (sign-ins,
 * 2FA changes) belong to no organization; they are shown for the people who
 * are members here.
 */
export const auditRouter = new Hono<{ Variables: TenantVariables }>().get(
  "/",
  async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can read the audit log."
    );
    if (orgId instanceof Response) return orgId;
    const limit = Math.min(
      Math.max(Number(c.req.query("limit")) || 100, 1),
      500
    );
    const before = c.req.query("before");
    const beforeDate = before ? new Date(before) : null;

    const members = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, orgId));
    const memberIds = members.map((m) => m.userId);

    const scope = memberIds.length
      ? or(
          eq(auditLog.organizationId, orgId),
          and(
            isNull(auditLog.organizationId),
            inArray(auditLog.userId, memberIds)
          )
        )
      : eq(auditLog.organizationId, orgId);
    const rows = await db
      .select({
        entry: auditLog,
        email: user.email,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.userId))
      .where(
        beforeDate && !Number.isNaN(beforeDate.getTime())
          ? and(scope, lt(auditLog.createdAt, beforeDate))
          : scope
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
    return c.json(
      rows.map((r) => ({
        ...r.entry,
        userEmail: r.entry.userEmail ?? r.email ?? null,
      }))
    );
  }
);
