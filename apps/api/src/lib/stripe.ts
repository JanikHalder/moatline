import crypto from "node:crypto";

/**
 * Stripe Billing with Managed Payments — Stripe as merchant of record: it
 * charges, handles VAT and sales tax, fraud, disputes and payment support.
 * Configured by environment only; a self-hosted instance has none of these
 * and bills nothing.
 *
 *   STRIPE_SECRET_KEY         sk_live_… / sk_test_… (or a restricted key)
 *   STRIPE_WEBHOOK_SECRET     whsec_… of the webhook endpoint
 *   STRIPE_PRICE_SOLO         monthly price of each plan (price_…)
 *   STRIPE_PRICE_TEAM
 *   STRIPE_PRICE_AGENCY
 *   STRIPE_MANAGED_PAYMENTS   "false" to bill as the merchant yourself
 *                             (then Stripe Tax and VAT are yours)
 *
 * No SDK: a handful of form-encoded REST calls.
 */

export type PlanId = "solo" | "team" | "agency";

/** The API version whose Checkout accepts managed_payments. */
const VERSION = "2026-04-22.dahlia";
const API = "https://api.stripe.com/v1";

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  plans: Partial<Record<PlanId, string>>;
  managedPayments: boolean;
  test: boolean;
};

export function stripeConfig(env = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const plans: Partial<Record<PlanId, string>> = {};
  for (const [id, key] of [
    ["solo", "STRIPE_PRICE_SOLO"],
    ["team", "STRIPE_PRICE_TEAM"],
    ["agency", "STRIPE_PRICE_AGENCY"],
  ] as const) {
    const v = env[key]?.trim();
    if (v) plans[id] = v;
  }
  if (!secretKey || !webhookSecret || !Object.keys(plans).length) return null;
  return {
    secretKey,
    webhookSecret,
    plans,
    managedPayments: env.STRIPE_MANAGED_PAYMENTS !== "false",
    test: /^(sk|rk)_test_/.test(secretKey),
  };
}

/** Nested params the way Stripe reads them: a[b][0][c]=… */
export function formEncode(
  params: Record<string, unknown>,
  prefix = ""
): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v))
      v.forEach((item, i) => {
        if (item && typeof item === "object")
          out.push(formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        else
          out.push(
            `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`
          );
      });
    else if (typeof v === "object")
      out.push(formEncode(v as Record<string, unknown>, key));
    else
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.filter(Boolean).join("&");
}

async function call<T>(
  c: StripeConfig,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.secretKey}`,
        "Stripe-Version": VERSION,
        ...(method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: method === "POST" && params ? formEncode(params) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: { message?: string } })
      | null;
    if (!res.ok)
      return {
        ok: false,
        error: `Stripe ${res.status}: ${json?.error?.message ?? "error"}`,
      };
    return { ok: true, data: json as T };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Stripe not reachable",
    };
  }
}

/** A hosted checkout for one plan; the organization rides along everywhere. */
export async function createCheckout(
  c: StripeConfig,
  opts: {
    priceId: string;
    organizationId: string;
    customerId: string | null;
    email: string | null;
    successUrl: string;
    cancelUrl: string;
  }
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const r = await call<{ url?: string }>(c, "POST", "/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: opts.priceId, quantity: 1 }],
    client_reference_id: opts.organizationId,
    metadata: { organizationId: opts.organizationId },
    subscription_data: { metadata: { organizationId: opts.organizationId } },
    ...(opts.customerId
      ? { customer: opts.customerId }
      : opts.email
        ? { customer_email: opts.email }
        : {}),
    ...(c.managedPayments ? { managed_payments: { enabled: true } } : {}),
    allow_promotion_codes: true,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!r.ok) return r;
  return r.data.url
    ? { ok: true, url: r.data.url }
    : { ok: false, error: "Stripe sent no checkout link." };
}

/**
 * Stripe's customer portal: invoices, payment method, cancelling — or,
 * with `switchTo`, straight to confirming another plan.
 */
export async function portalUrl(
  c: StripeConfig,
  opts: {
    customerId: string;
    returnUrl: string;
    switchTo?: { subscriptionId: string; itemId: string; priceId: string };
  }
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const r = await call<{ url?: string }>(
    c,
    "POST",
    "/billing_portal/sessions",
    {
      customer: opts.customerId,
      return_url: opts.returnUrl,
      ...(opts.switchTo
        ? {
            flow_data: {
              type: "subscription_update_confirm",
              subscription_update_confirm: {
                subscription: opts.switchTo.subscriptionId,
                items: [
                  {
                    id: opts.switchTo.itemId,
                    price: opts.switchTo.priceId,
                    quantity: 1,
                  },
                ],
              },
              after_completion: {
                type: "redirect",
                redirect: { return_url: opts.returnUrl },
              },
            },
          }
        : {}),
    }
  );
  if (!r.ok) return r;
  return r.data.url
    ? { ok: true, url: r.data.url }
    : { ok: false, error: "Stripe sent no portal link." };
}

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_end?: number | null;
  items?: {
    data?: Array<{
      id: string;
      quantity?: number;
      current_period_end?: number | null;
      price?: { id?: string };
    }>;
  };
};

export function getSubscription(c: StripeConfig, id: string) {
  return call<StripeSubscription>(
    c,
    "GET",
    `/subscriptions/${encodeURIComponent(id)}`
  );
}

/** Webhooks older than this are refused (replays). Stripe retries quickly. */
const TOLERANCE_S = 5 * 60;

/**
 * Stripe-Signature: "t=1671552777,v1=<hex>[,v1=…]", v1 = HMAC-SHA256 over
 * "<t>.<raw body>" with the endpoint's secret. The raw body exactly as
 * received — parsing and re-serializing would change it.
 */
export function verifySignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  nowS = Math.floor(Date.now() / 1000)
): boolean {
  if (!header) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) sigs.push(v);
  }
  if (t == null || !Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(nowS - t) > TOLERANCE_S) return false;
  const expected = Buffer.from(
    crypto
      .createHmac("sha256", secret)
      .update(`${t}.${rawBody}`, "utf8")
      .digest("hex"),
    "hex"
  );
  return sigs.some((s) =>
    crypto.timingSafeEqual(Buffer.from(s, "hex"), expected)
  );
}
