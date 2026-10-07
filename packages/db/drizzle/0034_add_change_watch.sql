-- Watch the default branch and the deployed version for changes.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "branch_head" text;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "deployed_commit" text;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "changes_checked_at" timestamp;
