import { count, eq } from "drizzle-orm";
import {
  billingAccounts,
  billingEvents,
  db,
  organization,
  repositories,
  servers,
} from "db";
import { isBillingExempt } from "../lib/cloud";
import {
  getSubscription,
  stripeConfig,
  type PlanId,
  type StripeConfig,
  type StripeSubscription,
} from "../lib/stripe";

/**
 * The cloud service is paid only: an organization without an active
 * subscription can look around but not add servers or repositories.
 * Self-hosted instances (no Stripe configured) have no limits at all.
 *
 * Flat plans per organization, about what the server to host Moatline
 * yourself would cost — not a price per server, which reads as paying for
 * what one could run for free. Stripe bills them as merchant of record.
 */

const PAYING = new Set(["active", "trialing", "past_due"]);

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in euros, as shown; Stripe's price is what is charged. */
  eur: number;
  servers: number;
  /** null: no limit. */
  repositories: number | null;
};

export const PLANS: Plan[] = [
  { id: "solo", name: "Solo", eur: 8, servers: 3, repositories: 10 },
  { id: "team", name: "Team", eur: 24, servers: 15, repositories: null },
  { id: "agency", name: "Agency", eur: 49, servers: 50, repositories: null },
];

export const planById = (id: string | null | undefined) =>
  PLANS.find((p) => p.id === id) ?? null;

/** Which plan a Stripe price belongs to. */
export function planOfPrice(
  cfg: Pick<StripeConfig, "plans">,
  priceId: string | null | undefined
): PlanId | null {
  if (!priceId) return null;
  for (const [id, p] of Object.entries(cfg.plans))
    if (p === priceId) return id as PlanId;
  return null;
}

/** Whether usage fits into a plan; the reason when it does not. */
export function overLimit(
  plan: Plan,
  used: { servers: number; repositories: number }
): string | null {
  if (used.servers > plan.servers)
    return `${plan.name} includes ${plan.servers} servers; this organization has ${used.servers}.`;
  if (plan.repositories != null && used.repositories > plan.repositories)
    return `${plan.name} includes ${plan.repositories} repositories; this organization has ${used.repositories}.`;
  return null;
}

export type BillingState = {
  enabled: boolean;
  organizationId: string;
  /**
   * "selfhosted": no billing; "active": paying; "free": exempt by the
   * operator (BILLING_FREE_ORGS); "none": no subscription.
   */
  plan: "selfhosted" | "active" | "free" | "none";
  /** The plan paid for. */
  tier: PlanId | null;
  status: string | null;
  usage: { servers: number; repositories: number };
  periodEndsAt: string | null;
  scheduledChange: { action: string; effectiveAt: string | null } | null;
  /** The plans on offer. */
  plans: Plan[];
  /** Stripe's test mode: no real money moves. */
  test: boolean;
};

async function usage(organizationId: string) {
  const [[s], [r]] = await Promise.all([
    db
      .select({ n: count() })
      .from(servers)
      .where(eq(servers.organizationId, organizationId)),
    db
      .select({ n: count() })
      .from(repositories)
      .where(eq(repositories.organizationId, organizationId)),
  ]);
  return { servers: s?.n ?? 0, repositories: r?.n ?? 0 };
}

export async function accountOf(organizationId: string) {
  const [acct] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.organizationId, organizationId));
  return acct;
}

export async function billingState(
  organizationId: string
): Promise<BillingState> {
  const cfg = stripeConfig();
  const used = await usage(organizationId);
  if (!cfg)
    return {
      enabled: false,
      organizationId,
      plan: "selfhosted",
      tier: null,
      status: null,
      usage: used,
      periodEndsAt: null,
      scheduledChange: null,
      plans: [],
      test: false,
    };
  const [acct, [org]] = await Promise.all([
    accountOf(organizationId),
    db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, organizationId)),
  ]);
  const change = acct?.scheduledChange as {
    action?: string;
    effectiveAt?: string;
  } | null;
  return {
    enabled: true,
    organizationId,
    plan:
      acct?.status && PAYING.has(acct.status)
        ? "active"
        : isBillingExempt({ id: organizationId, slug: org?.slug })
          ? "free"
          : "none",
    tier: (planById(acct?.plan)?.id as PlanId | undefined) ?? null,
    status: acct?.status ?? null,
    usage: used,
    periodEndsAt: acct?.periodEndsAt?.toISOString() ?? null,
    scheduledChange: change?.action
      ? { action: change.action, effectiveAt: change.effectiveAt ?? null }
      : null,
    plans: PLANS.filter((p) => cfg.plans[p.id]),
    test: cfg.test,
  };
}

/**
 * Whether the organization may add servers or repositories. null: yes.
 * Otherwise the message for the 402 answer.
 */
export async function blockedBy(
  organizationId: string,
  what: "server" | "repository"
): Promise<string | null> {
  if (!stripeConfig()) return null;
  const state = await billingState(organizationId);
  if (state.plan === "free") return null;
  if (state.plan !== "active")
    return what === "server"
      ? "Adding servers needs a subscription — choose a plan under Settings → Billing, or self-host Moatline for free."
      : "Adding repositories needs a subscription — choose a plan under Settings → Billing, or self-host Moatline for free.";
  const plan = planById(state.tier);
  if (!plan) return null;
  const bigger = PLANS.find(
    (p) =>
      p.eur > plan.eur &&
      (what === "server"
        ? p.servers > plan.servers
        : p.repositories == null ||
          p.repositories > (plan.repositories ?? Infinity))
  );
  const next = bigger
    ? ` Switch to ${bigger.name} under Settings → Billing.`
    : "";
  if (what === "server" && state.usage.servers >= plan.servers)
    return `${plan.name} includes ${plan.servers} servers.${next}`;
  if (
    what === "repository" &&
    plan.repositories != null &&
    state.usage.repositories >= plan.repositories
  )
    return `${plan.name} includes ${plan.repositories} repositories.${next}`;
  return null;
}

/** Whether a smaller plan still fits what the organization has. */
export async function fits(organizationId: string, plan: Plan) {
  return overLimit(plan, await usage(organizationId));
}

/** What a subscription means for the organization's row. */
export function accountFromSubscription(
  sub: StripeSubscription,
  cfg: Pick<StripeConfig, "plans">
) {
  const items = sub.items?.data ?? [];
  const item = items.find((i) => planOfPrice(cfg, i.price?.id)) ?? items[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end ?? null;
  const cancelAt =
    sub.cancel_at ?? (sub.cancel_at_period_end ? periodEnd : null);
  return {
    customerId: sub.customer,
    subscriptionId: sub.id,
    status: sub.status,
    quantity: item?.quantity ?? 1,
    plan: planOfPrice(cfg, item?.price?.id),
    periodEndsAt: periodEnd ? new Date(periodEnd * 1000) : null,
    scheduledChange: cancelAt
      ? {
          action: "cancel",
          effectiveAt: new Date(cancelAt * 1000).toISOString(),
        }
      : null,
  };
}

export type StripeEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

/**
 * Apply a verified webhook: subscription changes and finished checkouts.
 * Each event once; one older than the last applied is ignored (Stripe does
 * not guarantee order). The subscription is read fresh from Stripe, so the
 * row is the current state whatever the event carried.
 */
export async function applyEvent(
  event: StripeEvent
): Promise<"applied" | "ignored" | "duplicate"> {
  const cfg = stripeConfig();
  if (!cfg) return "ignored";
  const obj = event.data?.object ?? {};
  let subscriptionId: string | null = null;
  let orgId: string | null = null;
  if (event.type === "checkout.session.completed") {
    subscriptionId =
      typeof obj.subscription === "string" ? obj.subscription : null;
    orgId =
      typeof obj.client_reference_id === "string"
        ? obj.client_reference_id
        : null;
  } else if (event.type.startsWith("customer.subscription.")) {
    subscriptionId = typeof obj.id === "string" ? obj.id : null;
    const meta = obj.metadata as Record<string, string> | undefined;
    orgId = meta?.organizationId ?? null;
  } else return "ignored";
  if (!subscriptionId) return "ignored";

  const inserted = await db
    .insert(billingEvents)
    .values({ eventId: event.id })
    .onConflictDoNothing()
    .returning({ id: billingEvents.eventId });
  if (!inserted.length) return "duplicate";

  const fresh = await getSubscription(cfg, subscriptionId);
  if (!fresh.ok) throw new Error(fresh.error);
  orgId ??= fresh.data.metadata?.organizationId ?? null;
  if (!orgId) return "ignored";

  const at = new Date(event.created * 1000);
  const [current] = await db
    .select({ eventAt: billingAccounts.eventAt })
    .from(billingAccounts)
    .where(eq(billingAccounts.organizationId, orgId));
  if (current?.eventAt && current.eventAt > at) return "ignored";

  const values = {
    ...accountFromSubscription(fresh.data, cfg),
    eventAt: at,
    updatedAt: new Date(),
  };
  await db
    .insert(billingAccounts)
    .values({ organizationId: orgId, ...values })
    .onConflictDoUpdate({
      target: billingAccounts.organizationId,
      set: values,
    });
  return "applied";
}
