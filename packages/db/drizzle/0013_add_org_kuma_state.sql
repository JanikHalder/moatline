-- All Uptime Kuma monitors of an organization from the last pull, including
-- those not attached to any server, for the uptime overview.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "kuma_state" jsonb;
