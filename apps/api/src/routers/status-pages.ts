import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, repositories, statusPages } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization, requireSession } from "../middleware/tenant";
import { audit } from "../lib/audit-log";
import { publicStatus, slugOk } from "../services/status-pages";

const pageSchema = z.object({
  title: z.string().trim().min(1).max(80),
  slug: z.string().trim().toLowerCase(),
  description: z.string().trim().max(300).nullable().optional(),
  components: z
    .array(
      z.object({
        repositoryId: z.string().uuid(),
        name: z.string().trim().min(1).max(60),
      })
    )
    .max(30),
  published: z.boolean(),
});

type Body = z.infer<typeof pageSchema>;

/** A slug that is free, and sites that belong to the organization. */
async function check(
  orgId: string,
  b: Body,
  id: string | null
): Promise<string | null> {
  if (!slugOk(b.slug))
    return "The address may use a–z, 0–9 and dashes, 3 to 40 characters.";
  const [taken] = await db
    .select({ id: statusPages.id })
    .from(statusPages)
    .where(
      id
        ? and(eq(statusPages.slug, b.slug), ne(statusPages.id, id))
        : eq(statusPages.slug, b.slug)
    );
  if (taken) return "This address is taken — choose another.";
  const ids = [...new Set(b.components.map((c) => c.repositoryId))];
  if (ids.length) {
    const own = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          inArray(repositories.id, ids),
          eq(repositories.organizationId, orgId)
        )
      );
    if (own.length !== ids.length) return "Unknown site on the page.";
  }
  return null;
}

/** The organization's status pages. */
export const statusPagesRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const rows = await db
      .select()
      .from(statusPages)
      .where(eq(statusPages.organizationId, orgId));
    return c.json({ pages: rows });
  })
  .post("/", zValidator("json", pageSchema), async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const b = c.req.valid("json");
    const bad = await check(orgId, b, null);
    if (bad) return c.json({ error: bad }, 400);
    const [row] = await db
      .insert(statusPages)
      .values({
        organizationId: orgId,
        ...b,
        description: b.description ?? null,
      })
      .returning();
    await audit(c, "status_page.create", {
      type: "status_page",
      id: row!.id,
      name: b.title,
    });
    return c.json(row, 201);
  })
  .put("/:id", zValidator("json", pageSchema), async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const b = c.req.valid("json");
    const bad = await check(orgId, b, id);
    if (bad) return c.json({ error: bad }, 400);
    const [row] = await db
      .update(statusPages)
      .set({ ...b, description: b.description ?? null, updatedAt: new Date() })
      .where(and(eq(statusPages.id, id), eq(statusPages.organizationId, orgId)))
      .returning();
    if (!row) return c.json({ error: "Not found" }, 404);
    await audit(c, "status_page.update", {
      type: "status_page",
      id,
      name: b.title,
    });
    return c.json(row);
  })
  .delete("/:id", async (c) => {
    const orgId = requireSession(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [row] = await db
      .delete(statusPages)
      .where(and(eq(statusPages.id, id), eq(statusPages.organizationId, orgId)))
      .returning({ title: statusPages.title });
    if (!row) return c.json({ error: "Not found" }, 404);
    await audit(c, "status_page.delete", {
      type: "status_page",
      id,
      name: row.title,
    });
    return c.json({ ok: true });
  });

/** Anyone may read a published page — it is meant to be shared. */
export const publicStatusRouter = new Hono().get("/:slug", async (c) => {
  const slug = c.req.param("slug").toLowerCase();
  if (!slugOk(slug)) return c.json({ error: "Not found" }, 404);
  const page = await publicStatus(slug);
  if (!page) return c.json({ error: "Not found" }, 404);
  c.header("cache-control", "public, max-age=30");
  return c.json(page);
});
