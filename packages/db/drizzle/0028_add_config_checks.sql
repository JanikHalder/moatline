-- What a deployment says about its configuration, and which required
-- environment variables its Dokploy application has (names only).
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_checks" jsonb;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "config_check" jsonb;
