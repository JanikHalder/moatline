import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, apiKeys, repositories, servers } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin } from "../middleware/tenant";
import { generateApiKey } from "../lib/agent-token";
import { audit } from "../lib/audit-log";

const ADMIN = "Only an owner or admin can manage API keys.";

const uuidList = z.array(z.string().uuid()).max(200).nullable().optional();

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scan: z.boolean().default(false),
  fix: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
  allowedRepoIds: uuidList,
  allowedServerIds: uuidList,
});

async function validateAllowlists(
  orgId: string,
  repoIds: string[] | null | undefined,
  serverIds: string[] | null | undefined
): Promise<string | null> {
  if (repoIds && repoIds.length > 0) {
    const rows = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          eq(repositories.organizationId, orgId),
          inArray(repositories.id, repoIds)
        )
      );
    if (rows.length !== repoIds.length)
      return "One or more repositories are not in this organization.";
  }
  if (serverIds && serverIds.length > 0) {
    const rows = await db
      .select({ id: servers.id })
      .from(servers)
      .where(
        and(eq(servers.organizationId, orgId), inArray(servers.id, serverIds))
      );
    if (rows.length !== serverIds.length)
      return "One or more servers are not in this organization.";
  }
  return null;
}

function scopesFrom(body: { scan: boolean; fix: boolean }): string[] {
  const scopes = ["read"];
  if (body.scan) scopes.push("scan");
  if (body.fix) scopes.push("fix");
  return scopes;
}

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
        allowedRepoIds: apiKeys.allowedRepoIds,
        allowedServerIds: apiKeys.allowedServerIds,
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
    const bad = await validateAllowlists(
      orgId,
      body.allowedRepoIds,
      body.allowedServerIds
    );
    if (bad) return c.json({ error: bad }, 400);
    const k = generateApiKey();
    const scopes = scopesFrom(body);
    const allowedRepoIds =
      body.allowedRepoIds && body.allowedRepoIds.length > 0
        ? body.allowedRepoIds
        : null;
    const allowedServerIds =
      body.allowedServerIds && body.allowedServerIds.length > 0
        ? body.allowedServerIds
        : null;
    const [row] = await db
      .insert(apiKeys)
      .values({
        organizationId: orgId,
        createdBy: c.get("user")?.id ?? null,
        name: body.name,
        keyHash: k.hash,
        prefix: k.prefix,
        scopes,
        allowedRepoIds,
        allowedServerIds,
        expiresAt: body.expiresInDays
          ? new Date(Date.now() + body.expiresInDays * 86_400_000)
          : null,
      })
      .returning({ id: apiKeys.id });
    await audit(
      c,
      "api_key.create",
      { type: "api_key", id: row!.id, name: body.name },
      { scopes, allowedRepoIds, allowedServerIds }
    );
    return c.json(
      {
        id: row!.id,
        key: k.key,
        scopes,
        allowedRepoIds,
        allowedServerIds,
      },
      201
    );
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
