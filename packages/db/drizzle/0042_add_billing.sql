-- Cloud plans (Paddle), mirrored from its webhooks.
CREATE TABLE IF NOT EXISTS "billing_accounts" (
  "organization_id" text PRIMARY KEY NOT NULL,
  "customer_id" text,
  "subscription_id" text,
  "status" text,
  "quantity" integer DEFAULT 0 NOT NULL,
  "period_ends_at" timestamp,
  "scheduled_change" jsonb,
  "event_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "billing_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL
);
