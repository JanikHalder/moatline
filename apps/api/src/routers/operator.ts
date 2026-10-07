import { Hono } from "hono";
import type { TenantVariables } from "../middleware/tenant";
import { isOperator, operatorStats } from "../services/operator-stats";

/**
 * Figures across every organization, for the people running this
 * instance (OPERATOR_EMAILS). They show customers' email addresses, so
 * only with a signed-in session and two-factor authentication.
 */
export const operatorRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/me", (c) =>
    c.json({ operator: !!c.get("session") && isOperator(c.get("user")?.email) })
  )
  .get("/stats", async (c) => {
    const u = c.get("user");
    if (!c.get("session") || !u)
      return c.json({ error: "Authentication required" }, 401);
    if (!isOperator(u.email)) return c.json({ error: "Not found" }, 404);
    if (!u.twoFactorEnabled)
      return c.json(
        {
          error:
            "Turn on two-factor authentication under Account first — these figures include every customer's email address.",
        },
        403
      );
    c.header("Cache-Control", "no-store");
    return c.json(await operatorStats());
  });
