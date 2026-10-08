import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
  members: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
  allowedRepoIds: uuidList,
  allowedServerIds: uuidList,
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  scan: z.boolean().optional(),
  fix: z.boolean().optional(),
  members: z.boolean().optional(),
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

function scopesFrom(body: {
  scan: boolean;
  fix: boolean;
  members: boolean;
}): string[] {
  const scopes = ["read"];
  if (body.scan) scopes.push("scan");
  if (body.fix) scopes.push("fix");
  if (body.members) scopes.push("members");
  return scopes;
}

function normalizeAllowlist(ids: string[] | null | undefined): string[] | null {
  return ids && ids.length > 0 ? ids : null;
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
    const scopes = scopesFrom({
      scan: body.scan,
      fix: body.fix,
      members: body.members,
    });
    const allowedRepoIds = normalizeAllowlist(body.allowedRepoIds);
    const allowedServerIds = normalizeAllowlist(body.allowedServerIds);
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
  .patch("/:id", zValidator("json", patchSchema), async (c) => {
    const orgId = await requireOrgAdmin(c, ADMIN);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (
      body.name === undefined &&
      body.scan === undefined &&
      body.fix === undefined &&
      body.members === undefined &&
      body.allowedRepoIds === undefined &&
      body.allowedServerIds === undefined
    ) {
      return c.json({ error: "Nothing to update." }, 400);
    }
    const [existing] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, orgId)));
    if (!existing) return c.json({ error: "API key not found" }, 404);
    if (existing.revokedAt)
      return c.json({ error: "Revoked keys cannot be changed." }, 400);

    const bad = await validateAllowlists(
      orgId,
      body.allowedRepoIds,
      body.allowedServerIds
    );
    if (bad) return c.json({ error: bad }, 400);

    const scan = body.scan ?? existing.scopes.includes("scan");
    const fix = body.fix ?? existing.scopes.includes("fix");
    const members = body.members ?? existing.scopes.includes("members");
    const scopes = scopesFrom({ scan, fix, members });

    const patch: Partial<typeof apiKeys.$inferInsert> = { scopes };
    if (body.name !== undefined) patch.name = body.name;
    if (body.allowedRepoIds !== undefined)
      patch.allowedRepoIds = normalizeAllowlist(body.allowedRepoIds);
    if (body.allowedServerIds !== undefined)
      patch.allowedServerIds = normalizeAllowlist(body.allowedServerIds);

    const [row] = await db
      .update(apiKeys)
      .set(patch)
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        allowedRepoIds: apiKeys.allowedRepoIds,
        allowedServerIds: apiKeys.allowedServerIds,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      });
    await audit(
      c,
      "api_key.update",
      { type: "api_key", id: row!.id, name: row!.name },
      {
        scopes: `${existing.scopes.join(",")} → ${scopes.join(",")}`,
        ...(body.allowedRepoIds !== undefined && {
          allowedRepoIds: patch.allowedRepoIds,
        }),
        ...(body.allowedServerIds !== undefined && {
          allowedServerIds: patch.allowedServerIds,
        }),
      }
    );
    return c.json(row);
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
