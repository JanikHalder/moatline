import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, deployRuns, repositories } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization } from "../middleware/tenant";

export const deployRunsRouter = new Hono<{ Variables: TenantVariables }>().get(
  "/:id",
  async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const id = c.req.param("id");
    const [run] = await db
      .select()
      .from(deployRuns)
      .where(eq(deployRuns.id, id));
    if (!run) return c.json({ error: "Deploy run not found" }, 404);
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, run.repositoryId),
          eq(repositories.organizationId, orgId)
        )
      );
    if (!repo) return c.json({ error: "Deploy run not found" }, 404);
    return c.json(run);
  }
);
