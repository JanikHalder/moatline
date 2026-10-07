import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { clients, db, provisionRuns } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin, requireOrganization } from "../middleware/tenant";
import { audit } from "../lib/audit-log";
import {
  provisionOptions,
  startProvision,
  templateEnv,
} from "../services/provision";
import { blockedBy } from "../services/billing";

const name = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "Enter a domain like kunde.at or www.kunde.at"
  );

const provisionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  clientId: z.string().uuid().nullable(),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("template"),
      template: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      owner: name,
      repo: name,
      private: z.boolean(),
    }),
    z.object({
      kind: z.literal("existing"),
      fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    }),
  ]),
  branch: z.string().regex(/^[\w./-]{1,100}$/),
  environment: z.union([
    z.object({ id: z.string().min(1), legacy: z.boolean() }),
    z.object({ newProject: z.string().trim().min(1).max(80) }),
  ]),
  serverId: z.string().min(1).nullable(),
  githubProviderId: z.string().min(1),
  database: z.enum(["postgres", "mongo", "none"]),
  backupDestinationId: z.string().min(1).nullable(),
  domain: hostname,
  env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().max(5000)),
  envKeys: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        example: z.string().max(500),
      })
    )
    .max(200),
  autoHeal: z.boolean(),
});

export const provisionRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/options", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(await provisionOptions(orgId));
  })
  .get("/template-env", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(await templateEnv(orgId, c.req.query("repo") ?? ""));
  })
  // Creates repositories, Dokploy services and DNS-facing domains: admins only.
  .post("/", zValidator("json", provisionSchema), async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can create sites."
    );
    if (orgId instanceof Response) return orgId;
    const blocked = await blockedBy(orgId, "repository");
    if (blocked) return c.json({ error: blocked }, 402);
    const input = c.req.valid("json");
    if (input.clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(eq(clients.id, input.clientId), eq(clients.organizationId, orgId))
        );
      if (!client) return c.json({ error: "Client not found" }, 404);
    }
    const id = await startProvision(orgId, input);
    await audit(
      c,
      "site.provision",
      { type: "provision", id, name: input.name },
      { domain: input.domain, database: input.database }
    );
    return c.json({ id }, 202);
  })
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(
      await db
        .select()
        .from(provisionRuns)
        .where(eq(provisionRuns.organizationId, orgId))
        .orderBy(desc(provisionRuns.createdAt))
        .limit(20)
    );
  })
  .get("/:id", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [run] = await db
      .select()
      .from(provisionRuns)
      .where(
        and(
          eq(provisionRuns.id, c.req.param("id")),
          eq(provisionRuns.organizationId, orgId)
        )
      );
    if (!run) return c.json({ error: "Not found" }, 404);
    return c.json(run);
  });
