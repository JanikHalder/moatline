ALTER TABLE "api_keys" ADD COLUMN "allowed_repo_ids" jsonb;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "allowed_server_ids" jsonb;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD COLUMN "automation_policy" jsonb;
