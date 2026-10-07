import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { cronChecks, db } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization, requireSession } from "../middleware/tenant";
import { audit } from "../lib/audit-log";
import { newToken, ping } from "../services/cron-checks";

const checkSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // A minute to 35 days.
  periodSeconds: z
    .number()
    .int()
    .min(60)
    .max(35 * 86400),
  graceSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 86400),
});

/** The organization's scheduled-job checks. */
export const cronChecksRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const rows = await db
      .select()
      .from(cronChecks)
      .where(eq(cronChecks.organizationId, orgId));
    return c.json({ checks: rows });
  })
  .post("/", zValidator("json", checkSchema), async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const b = c.req.valid("json");
    const [row] = await db
      .insert(cronChecks)
      .values({ organizationId: orgId, ...b, token: newToken() })
      .returning();
    await audit(c, "cron_check.create", {
      type: "cron_check",
      id: row!.id,
      name: b.name,
    });
    return c.json(row, 201);
  })
  .put("/:id", zValidator("json", checkSchema), async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .update(cronChecks)
      .set(c.req.valid("json"))
      .where(
        and(
          eq(cronChecks.id, c.req.param("id")),
          eq(cronChecks.organizationId, orgId)
        )
      )
      .returning();
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row);
  })
  .delete("/:id", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .delete(cronChecks)
      .where(
        and(
          eq(cronChecks.id, c.req.param("id")),
          eq(cronChecks.organizationId, orgId)
        )
      )
      .returning({ name: cronChecks.name });
    if (!row) return c.json({ error: "Not found" }, 404);
    await audit(c, "cron_check.delete", {
      type: "cron_check",
      id: c.req.param("id"),
      name: row.name,
    });
    return c.json({ ok: true });
  });

/**
 * Where jobs report in — `curl -fsS https://…/api/ping/<token>` after a
 * run, `/start` before it, `/fail` when it failed. GET or POST; the token
 * is the credential. Answers the same for unknown tokens: nothing to learn.
 */
const handle =
  (kind: "ok" | "fail" | "start") => async (c: import("hono").Context) => {
    const token = c.req.param("token") ?? "";
    if (!/^[\w-]{16,64}$/.test(token)) return c.text("OK\n");
    await ping(token, kind).catch((e) => console.error("[ping] failed:", e));
    return c.text("OK\n");
  };

export const pingRouter = new Hono()
  .on(["GET", "POST", "HEAD"], "/:token", handle("ok"))
  .on(["GET", "POST", "HEAD"], "/:token/start", handle("start"))
  .on(["GET", "POST", "HEAD"], "/:token/fail", handle("fail"));
