import { Hono } from "hono";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db, repositories, scans, packageFindings } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization } from "../middleware/tenant";

export const packagesRouter = new Hono<{ Variables: TenantVariables }>().get(
  "/",
  async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const repoId = c.req.query("repoId");
    const outdated = c.req.query("outdated") === "true";
    const orgRepos = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.organizationId, orgId));
    const repoIds = orgRepos.map((r) => r.id);
    if (repoIds.length === 0) return c.json([]);
    const repoFilter = repoId && repoIds.includes(repoId) ? [repoId] : repoIds;
    const successScans = await db
      .select()
      .from(scans)
      .where(
        and(
          inArray(scans.repositoryId, repoFilter),
          eq(scans.status, "success")
        )
      )
      .orderBy(desc(scans.startedAt));
    const latestByRepo = new Map<string, (typeof successScans)[0]>();
    for (const s of successScans) {
      if (!latestByRepo.has(s.repositoryId))
        latestByRepo.set(s.repositoryId, s);
    }
    const scanIds = [...latestByRepo.values()].map((s) => s.id);
    if (scanIds.length === 0) return c.json([]);
    let findings = await db
      .select()
      .from(packageFindings)
      .where(inArray(packageFindings.scanId, scanIds));
    if (outdated) {
      findings = findings.filter((f) => f.currentVersion !== f.latestVersion);
    }
    return c.json(findings);
  }
);
