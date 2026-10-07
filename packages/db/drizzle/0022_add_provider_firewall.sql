-- Hetzner Cloud firewalls: read-only tokens per organization, and the
-- firewall rules in front of each server as last read.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "hetzner_tokens" text;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "hetzner_state" jsonb;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "provider_firewall" jsonb;
