# Billing for the cloud service (Stripe)

Billing exists only on the hosted service. A self-hosted instance has no
Stripe variables and therefore no limits and no billing page.

## Model

- **Flat plans per organization**, not a price per server — a price per
  server reads as paying for what one could host for free:

  | Plan   | Price / month | Servers | Repositories |
  | ------ | ------------- | ------- | ------------ |
  | Solo   | 8 €           | 3       | 10           |
  | Team   | 24 €          | 15      | unlimited    |
  | Agency | 49 €          | 50      | unlimited    |

  Every plan has every feature. The limits are checked when a server or
  repository is added (HTTP 402 with the next bigger plan named); what is
  already there keeps working. Switching plans happens under Settings →
  Billing, confirmed on Stripe's page and charged or credited pro rata; a
  smaller plan has to fit what the organization already has.

- The numbers above are what the app shows (`PLANS` in
  `apps/api/src/services/billing.ts`); what is charged is the price in
  Stripe — keep both the same.
- **Paid only.** Without an active subscription (`active`, `trialing` or
  `past_due`) an organization can look around but not add servers or
  repositories. Agents of existing servers keep reporting.
- Want a trial? Set a trial period on the prices in Stripe — nothing to
  change here.

**Stripe is the merchant of record** (Managed Payments): it charges, handles
VAT and sales tax in more than 80 countries, fraud, disputes and payment
support, and sends the invoices. Austria and the rest of the EU are
supported business locations; the product must be a digital one with a
digital tax code (SaaS). Set `STRIPE_MANAGED_PAYMENTS=false` to bill as the
merchant yourself instead — then VAT (Stripe Tax, OSS) is yours.

## Setup

1. In Stripe (start in test mode): Settings → Managed Payments — enable it
   (Stripe checks eligibility).
2. Create **three products** — "Moatline Solo", "Moatline Team",
   "Moatline Agency" — each with the tax code **Software as a service
   (SaaS) – business use** (`txcd_10103001`) and one **recurring monthly
   price**: 8 €, 24 €, 49 €, tax-inclusive. (The customer portal allows one
   price per interval and product, so plans are products.)
3. Settings → Billing → **Customer portal**: allow updating the payment
   method, cancelling, and **switching plans** between the three prices
   (proration on). Plan changes in Moatline open the portal's confirmation
   page for exactly that switch.
4. Developers → **Webhooks**: add an endpoint
   `https://<your-domain>/api/billing/stripe/webhook` with the events
   `checkout.session.completed` and `customer.subscription.created`,
   `.updated` and `.deleted`, and copy its **signing secret**.
5. Set on the API service:

   ```
   STRIPE_SECRET_KEY=sk_test_…   # sk_live_… when going live; a restricted key works
   STRIPE_WEBHOOK_SECRET=whsec_…
   STRIPE_PRICE_SOLO=price_…
   STRIPE_PRICE_TEAM=price_…
   STRIPE_PRICE_AGENCY=price_…
   BILLING_FREE_ORGS=<your organization's slug>
   ```

Checkout is Stripe's hosted page, opened from Settings → Billing with the
organization's id as `client_reference_id` and subscription metadata; every
webhook leads back to it. Webhooks are verified (`Stripe-Signature`,
HMAC-SHA256, ±5 minutes), applied once each, read the subscription fresh
from Stripe, and older events arriving late are ignored. Invoices, payment
method and cancelling are in Stripe's customer portal, opened from the same
page.
