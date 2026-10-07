ALTER TABLE "repositories" ADD COLUMN "platform_kind" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "platform_app_id" text;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD COLUMN "komodo_base_url" text;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD COLUMN "komodo_api_key" text;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD COLUMN "komodo_api_secret" text;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD COLUMN "portainer_base_url" text;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD COLUMN "portainer_token" text;
