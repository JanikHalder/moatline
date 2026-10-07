-- Coolify as a second deploy target next to Dokploy.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "coolify_base_url" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "coolify_token" text;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "coolify_app_uuid" text;
