import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  billingAccounts: {},
  billingEvents: {},
  organization: {},
  repositories: {},
  servers: {},
}));

import {
  accountFromSubscription,
  blockedBy,
  overLimit,
  planOfPrice,
  PLANS,
} from "./billing";

const cfg = { plans: { solo: "price_s", team: "price_t" } };

describe("billing", () => {
  it("never blocks a self-hosted instance", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(await blockedBy("org", "server")).toBeNull();
  });

  it("knows each plan by its Stripe price", () => {
    expect(planOfPrice(cfg, "price_t")).toBe("team");
    expect(planOfPrice(cfg, "price_x")).toBeNull();
    expect(planOfPrice(cfg, null)).toBeNull();
  });

  it("reads the subscription Stripe sends, cancellation included", () => {
    expect(
      accountFromSubscription(
        {
          id: "sub_1",
          status: "active",
          customer: "cus_1",
          metadata: { organizationId: "org1" },
          cancel_at_period_end: true,
          items: {
            data: [
              {
                id: "si_1",
                quantity: 1,
                current_period_end: 1793836800,
                price: { id: "price_s" },
              },
            ],
          },
        },
        cfg
      )
    ).toEqual({
      customerId: "cus_1",
      subscriptionId: "sub_1",
      status: "active",
      quantity: 1,
      plan: "solo",
      periodEndsAt: new Date(1793836800 * 1000),
      scheduledChange: {
        action: "cancel",
        effectiveAt: new Date(1793836800 * 1000).toISOString(),
      },
    });
  });

  it("has three flat plans", () => {
    expect(PLANS.map((p) => [p.id, p.eur])).toEqual([
      ["solo", 8],
      ["team", 24],
      ["agency", 49],
    ]);
  });

  it("refuses a plan the organization has outgrown", () => {
    const solo = PLANS[0]!;
    expect(overLimit(solo, { servers: 3, repositories: 10 })).toBeNull();
    expect(overLimit(solo, { servers: 4, repositories: 1 })).toMatch(
      /3 servers/
    );
    expect(overLimit(solo, { servers: 1, repositories: 11 })).toMatch(
      /10 repositories/
    );
  });
});
