import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, orgIntegrations } from "db";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrganization } from "../middleware/tenant";
import { watchPlatforms, type PlatformWatch } from "../services/platform-watch";

/** The connected platforms' versions against their advisories. */
export const platformWatchRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    const [row] = await db
      .select({ platformWatch: orgIntegrations.platformWatch })
      .from(orgIntegrations)
      .where(eq(orgIntegrations.organizationId, orgId));
    return c.json((row?.platformWatch as PlatformWatch | null) ?? null);
  })
  .post("/check", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(await watchPlatforms(orgId));
  });
