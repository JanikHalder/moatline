ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "auto_fix_critical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "auto_fix_force" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "auto_merge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "auto_deploy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "dokploy_application_id" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "scan_schedule" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "package_manager" text;--> statement-breakpoint
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "scan_id" uuid;--> statement-breakpoint
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "pr_number" integer;--> statement-breakpoint
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "pr_url" text;--> statement-breakpoint
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "merged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "update_runs" ADD CONSTRAINT "update_runs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vulnerabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"severity" text NOT NULL,
	"ghsa_id" text,
	"cve_id" text,
	"title" text,
	"url" text,
	"vulnerable_range" text,
	"patched_version" text,
	"fix_available" boolean DEFAULT false NOT NULL,
	"fix_is_semver_major" boolean DEFAULT false NOT NULL,
	"is_direct" boolean DEFAULT false NOT NULL,
	"cvss_score" text
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vulnerabilities_scan_id_idx" ON "vulnerabilities" ("scan_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deploy_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"update_run_id" uuid,
	"status" text DEFAULT 'triggered' NOT NULL,
	"dokploy_application_id" text,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"error_message" text
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deploy_runs" ADD CONSTRAINT "deploy_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deploy_runs" ADD CONSTRAINT "deploy_runs_update_run_id_update_runs_id_fk" FOREIGN KEY ("update_run_id") REFERENCES "update_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_runs_repository_id_idx" ON "deploy_runs" ("repository_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"dokploy_base_url" text,
	"dokploy_token" text,
	"slack_webhook_url" text,
	"telegram_bot_token" text,
	"telegram_chat_id" text,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_user" text,
	"smtp_pass" text,
	"smtp_from" text,
	"notify_email_to" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_integrations_organization_id_unique" UNIQUE("organization_id")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_integrations" ADD CONSTRAINT "org_integrations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
