import { and, eq, or } from "drizzle-orm";
import { db, repositories } from "db";

/** Turn off auto-merge and auto-deploy when org policy requires PR review. */
export async function disableRepoAutonomy(
  orgId: string
): Promise<Array<{ id: string; name: string }>> {
  return db
    .update(repositories)
    .set({ autoMerge: false, autoDeploy: false })
    .where(
      and(
        eq(repositories.organizationId, orgId),
        or(eq(repositories.autoMerge, true), eq(repositories.autoDeploy, true))
      )
    )
    .returning({ id: repositories.id, name: repositories.name });
}
