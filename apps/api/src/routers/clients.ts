import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { clients, db, domains, repositories, servers } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization } from "../middleware/tenant";
import { audit } from "../lib/audit-log";
import { buildClientReport } from "../services/client-report";
import {
  checkAndStore,
  registrableDomain,
  syncDomainsForOrg,
  type DomainState,
} from "../services/domain-check";

const clientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactEmail: z.string().trim().email().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  language: z.enum(["de", "en"]).optional(),
});

/** Customers: their sites, servers, domains and the monthly report. */
export const clientsRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const list = await db
      .select()
      .from(clients)
      .where(eq(clients.organizationId, orgId))
      .orderBy(asc(clients.name));
    const repos = await db
      .select({
        id: repositories.id,
        name: repositories.name,
        clientId: repositories.clientId,
        liveStatus: repositories.liveStatus,
      })
      .from(repositories)
      .where(eq(repositories.organizationId, orgId));
    const srv = await db
      .select({ id: servers.id, clientId: servers.clientId })
      .from(servers)
      .where(eq(servers.organizationId, orgId));
    const doms = await db
      .select({ clientId: domains.clientId, state: domains.state })
      .from(domains)
      .where(eq(domains.organizationId, orgId));
    return c.json(
      list.map((cl) => {
        const mine = repos.filter((r) => r.clientId === cl.id);
        const myDomains = doms.filter((d) => d.clientId === cl.id);
        return {
          ...cl,
          repos: mine.length,
          down: mine.filter((r) => r.liveStatus === "down").length,
          servers: srv.filter((s) => s.clientId === cl.id).length,
          domains: myDomains.length,
          domainProblems: myDomains.reduce(
            (n, d) =>
              n +
              ((d.state as DomainState | null)?.problems ?? []).filter(
                (p) => p.severity !== "low"
              ).length,
            0
          ),
        };
      })
    );
  })
  .post("/", zValidator("json", clientSchema), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const body = c.req.valid("json");
    const [row] = await db
      .insert(clients)
      .values({ organizationId: orgId, ...body })
      .returning();
    await audit(c, "client.create", {
      type: "client",
      id: row!.id,
      name: row!.name,
    });
    return c.json(row, 201);
  })
  .get("/:id", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [client] = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, c.req.param("id")),
          eq(clients.organizationId, orgId)
        )
      );
    if (!client) return c.json({ error: "Client not found" }, 404);
    const [repos, srv, doms] = await Promise.all([
      db
        .select({
          id: repositories.id,
          name: repositories.name,
          githubUrl: repositories.githubUrl,
          liveUrl: repositories.liveUrl,
          liveStatus: repositories.liveStatus,
        })
        .from(repositories)
        .where(eq(repositories.clientId, client.id)),
      db
        .select({
          id: servers.id,
          name: servers.name,
          lastReportAt: servers.lastReportAt,
        })
        .from(servers)
        .where(eq(servers.clientId, client.id)),
      db.select().from(domains).where(eq(domains.clientId, client.id)),
    ]);
    return c.json({ ...client, repos, servers: srv, domains: doms });
  })
  .patch("/:id", zValidator("json", clientSchema.partial()), async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .update(clients)
      .set(c.req.valid("json"))
      .where(
        and(
          eq(clients.id, c.req.param("id")),
          eq(clients.organizationId, orgId)
        )
      )
      .returning();
    if (!row) return c.json({ error: "Client not found" }, 404);
    return c.json(row);
  })
  .delete("/:id", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .delete(clients)
      .where(
        and(
          eq(clients.id, c.req.param("id")),
          eq(clients.organizationId, orgId)
        )
      )
      .returning();
    if (!row) return c.json({ error: "Client not found" }, 404);
    await audit(c, "client.delete", {
      type: "client",
      id: row.id,
      name: row.name,
    });
    return c.json({ ok: true });
  })
  // Put repositories, servers and domains under a client (or none).
  .post(
    "/:id/assign",
    zValidator(
      "json",
      z.object({
        repositoryIds: z.array(z.string().uuid()).max(500).optional(),
        serverIds: z.array(z.string().uuid()).max(500).optional(),
        domainIds: z.array(z.string().uuid()).max(500).optional(),
      })
    ),
    async (c) => {
      const orgId = requireOrganization(c);
      if (orgId instanceof Response) return orgId;
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            eq(clients.id, c.req.param("id")),
            eq(clients.organizationId, orgId)
          )
        );
      if (!client) return c.json({ error: "Client not found" }, 404);
      const b = c.req.valid("json");
      if (b.repositoryIds?.length)
        await db
          .update(repositories)
          .set({ clientId: client.id })
          .where(
            and(
              inArray(repositories.id, b.repositoryIds),
              eq(repositories.organizationId, orgId)
            )
          );
      if (b.serverIds?.length)
        await db
          .update(servers)
          .set({ clientId: client.id })
          .where(
            and(
              inArray(servers.id, b.serverIds),
              eq(servers.organizationId, orgId)
            )
          );
      if (b.domainIds?.length)
        await db
          .update(domains)
          .set({ clientId: client.id })
          .where(
            and(
              inArray(domains.id, b.domainIds),
              eq(domains.organizationId, orgId)
            )
          );
      return c.json({ ok: true });
    }
  )
  // The monthly maintenance report, printable HTML (German, for the client).
  .get("/:id/report", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const now = new Date();
    const prev = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
    );
    const month =
      c.req.query("month") ??
      `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    const html = await buildClientReport(c.req.param("id"), orgId, month);
    if (!html) return c.json({ error: "Client or month not found" }, 404);
    c.header("content-type", "text/html; charset=utf-8");
    return c.body(html);
  });

/** Domains: certificate, registration and mail DNS. */
export const domainsRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    await syncDomainsForOrg(orgId).catch(() => {});
    const rows = await db
      .select()
      .from(domains)
      .where(eq(domains.organizationId, orgId))
      .orderBy(asc(domains.name));
    return c.json(rows);
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string().trim().max(253),
        clientId: z.string().uuid().nullable().optional(),
      })
    ),
    async (c) => {
      const orgId = requireOrganization(c);
      if (orgId instanceof Response) return orgId;
      const b = c.req.valid("json");
      const name = registrableDomain(
        b.name.replace(/^https?:\/\//, "").split("/")[0]!
      );
      if (!name) return c.json({ error: "Not a domain name." }, 400);
      const [row] = await db
        .insert(domains)
        .values({
          organizationId: orgId,
          name,
          clientId: b.clientId ?? null,
          source: "manual",
        })
        .onConflictDoNothing()
        .returning();
      if (row) void checkAndStore(row.id).catch(() => {});
      return c.json(row ?? { error: "Already added" }, row ? 201 : 409);
    }
  )
  .post("/:id/check", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [d] = await db
      .select({ id: domains.id })
      .from(domains)
      .where(
        and(
          eq(domains.id, c.req.param("id")),
          eq(domains.organizationId, orgId)
        )
      );
    if (!d) return c.json({ error: "Domain not found" }, 404);
    const state = await checkAndStore(d.id);
    return c.json(state);
  })
  .patch(
    "/:id",
    zValidator("json", z.object({ clientId: z.string().uuid().nullable() })),
    async (c) => {
      const orgId = requireOrganization(c);
      if (orgId instanceof Response) return orgId;
      const [row] = await db
        .update(domains)
        .set({ clientId: c.req.valid("json").clientId })
        .where(
          and(
            eq(domains.id, c.req.param("id")),
            eq(domains.organizationId, orgId)
          )
        )
        .returning();
      if (!row) return c.json({ error: "Domain not found" }, 404);
      return c.json(row);
    }
  )
  .delete("/:id", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    await db
      .delete(domains)
      .where(
        and(
          eq(domains.id, c.req.param("id")),
          eq(domains.organizationId, orgId)
        )
      );
    return c.json({ ok: true });
  });
