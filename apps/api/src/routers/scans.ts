import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, scans, repositories, packageFindings, vulnerabilities } from "db";
import type { Context } from "hono";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization } from "../middleware/tenant";

/** Load a scan and verify it belongs to the caller's org. */
async function loadOwnedScan(
  c: Context<{ Variables: TenantVariables }>,
  orgId: string,
  scanId: string
) {
  const [scanRow] = await db.select().from(scans).where(eq(scans.id, scanId));
  if (!scanRow) return null;
  const [repo] = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, scanRow.repositoryId),
        eq(repositories.organizationId, orgId)
      )
    );
  return repo ? scanRow : null;
}

export const scansRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/:scanId/findings", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const scanId = c.req.param("scanId");
    const scanRow = await loadOwnedScan(c, orgId, scanId);
    if (!scanRow) return c.json({ error: "Scan not found" }, 404);
    const findings = await db
      .select()
      .from(packageFindings)
      .where(eq(packageFindings.scanId, scanId));
    return c.json(findings);
  })
  .get("/:scanId/vulnerabilities", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const scanId = c.req.param("scanId");
    const scanRow = await loadOwnedScan(c, orgId, scanId);
    if (!scanRow) return c.json({ error: "Scan not found" }, 404);
    const rows = await db
      .select()
      .from(vulnerabilities)
      .where(eq(vulnerabilities.scanId, scanId));
    return c.json(rows);
  });
