-- Evidence that an automated security fix removed the advisories it claimed
-- to fix. A green build only proves the project still compiles.
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "security_verified" boolean;
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "security_summary" text;
