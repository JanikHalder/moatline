-- Read-only security checks of the live site from outside.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "site_probe" jsonb;
