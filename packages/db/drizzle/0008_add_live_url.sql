-- Where a repository is deployed, plus the last result of looking at it.
-- A Dokploy deploy trigger only reports that the request was accepted, so
-- without this there is no way to answer "is the fix live?".
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_url" text;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_status" text;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_http_status" integer;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_commit" text;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_error" text;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_checked_at" timestamp;

-- Outcome of watching the live URL after a deploy was triggered.
ALTER TABLE "deploy_runs" ADD COLUMN IF NOT EXISTS "live_ok" boolean;
ALTER TABLE "deploy_runs" ADD COLUMN IF NOT EXISTS "live_detail" text;
ALTER TABLE "deploy_runs" ADD COLUMN IF NOT EXISTS "live_verified_at" timestamp;
