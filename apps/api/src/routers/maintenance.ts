import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { db, maintenanceWindows, repositories, servers } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization, requireSession } from "../middleware/tenant";
import { audit } from "../lib/audit-log";

const startSchema = z.object({
  scope: z.enum(["organization", "server", "repository"]),
  targetId: z.string().max(100).nullable().optional(),
  // Five minutes to three days.
  minutes: z
    .number()
    .int()
    .min(5)
    .max(3 * 24 * 60),
  reason: z.string().trim().max(200).nullable().optional(),
});

/** Maintenance windows: alerts held back, status pages say so. */
export const maintenanceRouter = new Hono<{ Variables: TenantVariables }>()
  // Open and upcoming windows.
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const rows = await db
      .select()
      .from(maintenanceWindows)
      .where(
        and(
          eq(maintenanceWindows.organizationId, orgId),
          gt(maintenanceWindows.endsAt, new Date())
        )
      );
    return c.json({ windows: rows });
  })
  .post("/", zValidator("json", startSchema), async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const b = c.req.valid("json");
    const targetId = b.scope === "organization" ? null : (b.targetId ?? null);
    if (b.scope !== "organization") {
      if (!targetId) return c.json({ error: "Which one?" }, 400);
      const table = b.scope === "server" ? servers : repositories;
      const [own] = await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, targetId), eq(table.organizationId, orgId)));
      if (!own) return c.json({ error: "Not found" }, 404);
    }
    const now = new Date();
    const [row] = await db
      .insert(maintenanceWindows)
      .values({
        organizationId: orgId,
        scope: b.scope,
        targetId,
        reason: b.reason ?? null,
        startsAt: now,
        endsAt: new Date(now.getTime() + b.minutes * 60 * 1000),
        createdBy: c.get("user")?.email ?? null,
      })
      .returning();
    await audit(
      c,
      "maintenance.start",
      { type: b.scope, id: targetId },
      { minutes: b.minutes, reason: b.reason ?? null }
    );
    return c.json(row, 201);
  })
  // End a window now.
  .delete("/:id", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .update(maintenanceWindows)
      .set({ endsAt: new Date() })
      .where(
        and(
          eq(maintenanceWindows.id, c.req.param("id")),
          eq(maintenanceWindows.organizationId, orgId)
        )
      )
      .returning();
    if (!row) return c.json({ error: "Not found" }, 404);
    await audit(c, "maintenance.end", { type: row.scope, id: row.targetId });
    return c.json({ ok: true });
  });
