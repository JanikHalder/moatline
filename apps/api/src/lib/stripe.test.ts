import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { formEncode, stripeConfig, verifySignature } from "./stripe";

describe("stripe", () => {
  it("is off unless key, webhook secret and a price are set", () => {
    expect(stripeConfig({})).toBeNull();
    expect(
      stripeConfig({
        STRIPE_SECRET_KEY: "sk_test_1",
        STRIPE_WEBHOOK_SECRET: "w",
      })
    ).toBeNull();
    expect(
      stripeConfig({
        STRIPE_SECRET_KEY: "sk_test_1",
        STRIPE_WEBHOOK_SECRET: "whsec_1",
        STRIPE_PRICE_SOLO: "price_s",
      })
    ).toMatchObject({
      plans: { solo: "price_s" },
      managedPayments: true,
      test: true,
    });
    expect(
      stripeConfig({
        STRIPE_SECRET_KEY: "sk_live_1",
        STRIPE_WEBHOOK_SECRET: "whsec_1",
        STRIPE_PRICE_TEAM: "price_t",
        STRIPE_MANAGED_PAYMENTS: "false",
      })
    ).toMatchObject({ managedPayments: false, test: false });
  });

  it("encodes nested params the way Stripe reads them", () => {
    expect(
      decodeURIComponent(
        formEncode({
          mode: "subscription",
          line_items: [{ price: "price_s", quantity: 1 }],
          managed_payments: { enabled: true },
          skip: undefined,
        })
      )
    ).toBe(
      "mode=subscription&line_items[0][price]=price_s&line_items[0][quantity]=1&managed_payments[enabled]=true"
    );
  });

  it("accepts Stripe's signature and nothing else", () => {
    const secret = "whsec_test";
    const body = '{"id":"evt_1"}';
    const t = 1_800_000_000;
    const v1 = crypto
      .createHmac("sha256", secret)
      .update(`${t}.${body}`)
      .digest("hex");
    expect(verifySignature(body, `t=${t},v1=${v1}`, secret, t)).toBe(true);
    expect(
      verifySignature(body, `t=${t},v1=${"0".repeat(64)},v1=${v1}`, secret, t)
    ).toBe(true);
    expect(verifySignature(`${body} `, `t=${t},v1=${v1}`, secret, t)).toBe(
      false
    );
    expect(verifySignature(body, `t=${t},v1=${v1}`, secret, t + 3600)).toBe(
      false
    );
    expect(verifySignature(body, null, secret, t)).toBe(false);
  });
});
