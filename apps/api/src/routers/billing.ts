import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Context } from "hono";
import type { TenantVariables } from "../middleware/tenant";
import { requireOrgAdmin, requireOrganization } from "../middleware/tenant";
import {
  createCheckout,
  getSubscription,
  portalUrl,
  stripeConfig,
  verifySignature,
} from "../lib/stripe";
import {
  accountOf,
  applyEvent,
  billingState,
  fits,
  planById,
  type StripeEvent,
} from "../services/billing";
import { audit } from "../lib/audit-log";

/** Where Stripe sends the browser back: the billing settings. */
const settingsUrl = (c: Context, query = "") =>
  `${(process.env.APP_URL || new URL(c.req.url).origin).replace(/\/+$/, "")}/settings${query}`;

const planSchema = z.object({ plan: z.enum(["solo", "team", "agency"]) });

export const billingRouter = new Hono<{ Variables: TenantVariables }>()
  .get("/", async (c) => {
    const orgId = requireOrganization(c);
    if (orgId instanceof Response) return orgId;
    return c.json(await billingState(orgId));
  })
  // A hosted Stripe checkout for a plan; the browser goes there.
  .post("/checkout", zValidator("json", planSchema), async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can manage billing."
    );
    if (orgId instanceof Response) return orgId;
    const cfg = stripeConfig();
    if (!cfg)
      return c.json({ error: "Billing is not enabled on this instance." }, 400);
    const plan = planById(c.req.valid("json").plan)!;
    const priceId = cfg.plans[plan.id];
    if (!priceId) return c.json({ error: "This plan is not offered." }, 400);
    const tooBig = await fits(orgId, plan);
    if (tooBig)
      return c.json({ error: `${tooBig} Choose a bigger plan.` }, 400);
    const acct = await accountOf(orgId);
    const r = await createCheckout(cfg, {
      priceId,
      organizationId: orgId,
      customerId: acct?.customerId ?? null,
      email: c.get("user")?.email ?? null,
      successUrl: settingsUrl(c, "?billing=done"),
      cancelUrl: settingsUrl(c),
    });
    if (!r.ok) return c.json({ error: r.error }, 502);
    return c.json({ url: r.url });
  })
  // Another plan: Stripe's portal confirms it and charges pro rata.
  .post("/plan", zValidator("json", planSchema), async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can manage billing."
    );
    if (orgId instanceof Response) return orgId;
    const cfg = stripeConfig();
    if (!cfg)
      return c.json({ error: "Billing is not enabled on this instance." }, 400);
    const plan = planById(c.req.valid("json").plan)!;
    const priceId = cfg.plans[plan.id];
    if (!priceId) return c.json({ error: "This plan is not offered." }, 400);
    const tooBig = await fits(orgId, plan);
    if (tooBig)
      return c.json(
        { error: `${tooBig} Remove some first, or choose a bigger plan.` },
        400
      );
    const acct = await accountOf(orgId);
    if (!acct?.customerId || !acct.subscriptionId)
      return c.json({ error: "No subscription yet." }, 400);
    const sub = await getSubscription(cfg, acct.subscriptionId);
    if (!sub.ok) return c.json({ error: sub.error }, 502);
    const item = sub.data.items?.data?.[0];
    if (!item) return c.json({ error: "The subscription has no plan." }, 502);
    const r = await portalUrl(cfg, {
      customerId: acct.customerId,
      returnUrl: settingsUrl(c, "?billing=done"),
      switchTo: {
        subscriptionId: acct.subscriptionId,
        itemId: item.id,
        priceId,
      },
    });
    if (!r.ok) return c.json({ error: r.error }, 502);
    await audit(
      c,
      "billing.plan_change",
      { type: "organization", id: orgId },
      {
        plan: plan.id,
      }
    );
    return c.json({ url: r.url });
  })
  // Invoices, payment method and cancelling live in Stripe's portal.
  .post("/portal", async (c) => {
    const orgId = await requireOrgAdmin(
      c,
      "Only an owner or admin can manage billing."
    );
    if (orgId instanceof Response) return orgId;
    const cfg = stripeConfig();
    if (!cfg)
      return c.json({ error: "Billing is not enabled on this instance." }, 400);
    const acct = await accountOf(orgId);
    if (!acct?.customerId)
      return c.json({ error: "No subscription yet." }, 400);
    const r = await portalUrl(cfg, {
      customerId: acct.customerId,
      returnUrl: settingsUrl(c),
    });
    if (!r.ok) return c.json({ error: r.error }, 502);
    return c.json({ url: r.url });
  })
  // Stripe → here. No session: authenticated by the signature only.
  .post("/stripe/webhook", async (c) => {
    const cfg = stripeConfig();
    if (!cfg) return c.json({ error: "Billing is not enabled." }, 404);
    const raw = await c.req.text();
    if (raw.length > 512 * 1024) return c.json({ error: "Too large" }, 413);
    if (
      !verifySignature(raw, c.req.header("stripe-signature"), cfg.webhookSecret)
    )
      return c.json({ error: "Invalid signature" }, 401);
    let event: StripeEvent;
    try {
      event = JSON.parse(raw) as StripeEvent;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    try {
      return c.json({ ok: true, result: await applyEvent(event) });
    } catch (e) {
      // 500 makes Stripe retry later.
      console.error("[billing] webhook failed:", e);
      return c.json({ error: "Could not apply" }, 500);
    }
  });
