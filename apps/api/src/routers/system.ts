import { Hono } from "hono";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin, requireOrganization } from "../middleware/tenant";
import { getSchedulerStatus } from "../services/scheduler";
import { stripeConfig } from "../lib/stripe";
import { audit } from "../lib/audit-log";
import { startUpdate, updateStatus } from "../services/self-update";
import { isCloud } from "../lib/cloud";
import { db, user } from "db";
import { requireEmailVerification } from "../auth";

/**
 * Instance-level status the UI needs in order to explain itself. Without this,
 * a repository can carry a scan schedule while the instance runs with
 * ENABLE_SCHEDULER unset, and nothing ever happens — with no hint why.
 */
export const systemRouter = new Hono<{ Variables: TenantVariables }>()
  // Public: the sign-in page reads it before anyone is signed in.
  .get("/mode", async (c) => {
    // A fresh self-hosted instance: the first account sets it up.
    const firstAccount = isCloud()
      ? false
      : await db
          .select({ id: user.id })
          .from(user)
          .limit(1)
          .then((r) => r.length === 0)
          .catch(() => false);
    return c.json({
      cloud: isCloud(),
      signupOpen: isCloud() || firstAccount,
      firstAccount,
      emailVerification: requireEmailVerification,
    });
  })
  .get("/scheduler", (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(getSchedulerStatus());
  })
  // Version and updates of a self-hosted instance. The cloud service is
  // updated by its operator — its customers see nothing here.
  .get("/update", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    if (stripeConfig() || isCloud()) return c.json({ hidden: true });
    return c.json(await updateStatus());
  })
  .post("/update", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can update the instance."
    );
    if (orgId instanceof Response) return orgId;
    if (stripeConfig() || isCloud())
      return c.json({ error: "Updates are managed by the operator." }, 400);
    const res = await startUpdate();
    if (!res.ok) return c.json({ error: res.error }, 400);
    await audit(
      c,
      "system.update",
      { type: "instance" },
      { version: res.version }
    );
    return c.json(res, 202);
  });
