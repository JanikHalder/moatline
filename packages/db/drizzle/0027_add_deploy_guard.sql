-- Deploy guard: roll back a deploy that breaks the live site.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "auto_rollback" boolean DEFAULT false NOT NULL;
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "merge_sha" text;
ALTER TABLE "deploy_runs" ADD COLUMN IF NOT EXISTS "guard" text;
ALTER TABLE "deploy_runs" ADD COLUMN IF NOT EXISTS "guard_detail" text;
