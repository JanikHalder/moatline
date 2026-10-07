import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, apiKeys } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin } from "../middleware/tenant";
import { generateApiKey } from "../lib/agent-token";
import { audit } from "../lib/audit-log";

const ADMIN = "Only an owner or admin can manage API keys.";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scan: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
});

/** Organization API keys for the MCP endpoint. Shown once, stored hashed. */
export const apiKeysRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = await requireOrgAdmin(c, ADMIN);
    if (orgId instanceof Response) return orgId;
    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, orgId))
      .orderBy(desc(apiKeys.createdAt));
    return c.json(rows);
  })
  .post("/", zValidator("json", createSchema), async (c) => {
    const orgId = await requireOrgAdmin(c, ADMIN);
    if (orgId instanceof Response) return orgId;
    const body = c.req.valid("json");
    const k = generateApiKey();
    const scopes = body.scan ? ["read", "scan"] : ["read"];
    const [row] = await db
      .insert(apiKeys)
      .values({
        organizationId: orgId,
        createdBy: c.get("user")?.id ?? null,
        name: body.name,
        keyHash: k.hash,
        prefix: k.prefix,
        scopes,
        expiresAt: body.expiresInDays
          ? new Date(Date.now() + body.expiresInDays * 86_400_000)
          : null,
      })
      .returning({ id: apiKeys.id });
    await audit(
      c,
      "api_key.create",
      { type: "api_key", id: row!.id, name: body.name },
      { scopes }
    );
    // Returned exactly once — only its hash is stored.
    return c.json({ id: row!.id, key: k.key, scopes }, 201);
  })
  .delete("/:id", async (c) => {
    const orgId = await requireOrgAdmin(c, ADMIN);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, c.req.param("id")),
          eq(apiKeys.organizationId, orgId)
        )
      )
      .returning({ id: apiKeys.id, name: apiKeys.name });
    if (!row) return c.json({ error: "API key not found" }, 404);
    await audit(c, "api_key.revoke", {
      type: "api_key",
      id: row.id,
      name: row.name,
    });
    return c.json({ revoked: true });
  });
