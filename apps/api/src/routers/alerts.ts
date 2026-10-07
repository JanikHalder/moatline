import { Hono } from "hono";
import type { TenantVariables } from "../middleware/tenant";
import {
  orgForAlertToken,
  parseAlerts,
  receiveAlerts,
} from "../services/alerts";

export const alertsRouter = new Hono<{ Variables: TenantVariables }>().post(
  "/:token",
  async (c) => {
    const orgId = await orgForAlertToken(c.req.param("token"));
    // One answer for a wrong token and a missing one: nothing to probe.
    if (!orgId) return c.json({ error: "Unknown receiver" }, 404);
    const raw = await c.req.text();
    if (raw.length > 256 * 1024) return c.json({ error: "Too large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const alerts = parseAlerts(body);
    if (!alerts.length)
      return c.json({ error: "No alert in the payload" }, 400);
    return c.json(await receiveAlerts(orgId, alerts));
  }
);
