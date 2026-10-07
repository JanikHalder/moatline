-- Server monitoring: hosts that report in through an agent, and every problem
-- found on them (Trivy, CrowdSec, Nuclei, Uptime Kuma, Wazuh, load/disk/updates)
-- in one table with an open/resolved lifecycle.
CREATE TABLE IF NOT EXISTS "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"agent_token_hash" text,
	"agent_token_prefix" text,
	"agent_token_created_at" timestamp,
	"last_report_at" timestamp,
	"last_full_report_at" timestamp,
	"last_report" jsonb,
	"agent_version" text,
	"hostname" text,
	"os" text,
	"nuclei_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nuclei_schedule" text,
	"kuma_monitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wazuh_agent_id" text,
	"kuma_state" jsonb,
	"wazuh_state" jsonb,
	"cpu_threshold" integer DEFAULT 90 NOT NULL,
	"memory_threshold" integer DEFAULT 90 NOT NULL,
	"disk_threshold" integer DEFAULT 85 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "servers_agent_token_hash_unique" UNIQUE("agent_token_hash")
);
DO $$ BEGIN
 ALTER TABLE "servers" ADD CONSTRAINT "servers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "servers_organization_id_idx" ON "servers" USING btree ("organization_id");

CREATE TABLE IF NOT EXISTS "server_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"repository_id" uuid,
	"source" text NOT NULL,
	"fingerprint" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"target" text,
	"reference" text,
	"fix_available" boolean,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
DO $$ BEGIN
 ALTER TABLE "server_findings" ADD CONSTRAINT "server_findings_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "server_findings" ADD CONSTRAINT "server_findings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "server_findings_identity_idx" ON "server_findings" USING btree ("server_id","source","fingerprint");
CREATE INDEX IF NOT EXISTS "server_findings_server_open_idx" ON "server_findings" USING btree ("server_id","resolved_at");
CREATE INDEX IF NOT EXISTS "server_findings_repository_idx" ON "server_findings" USING btree ("repository_id");

CREATE TABLE IF NOT EXISTS "server_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"cpu_pct" real,
	"memory_pct" real,
	"disk_pct" real,
	"pending_updates" integer,
	"security_updates" integer
);
DO $$ BEGIN
 ALTER TABLE "server_metrics" ADD CONSTRAINT "server_metrics_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "server_metrics_server_time_idx" ON "server_metrics" USING btree ("server_id","recorded_at");

CREATE TABLE IF NOT EXISTS "server_scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"tool" text DEFAULT 'nuclei' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"finding_count" integer,
	"error_message" text,
	"log" text
);
DO $$ BEGIN
 ALTER TABLE "server_scan_runs" ADD CONSTRAINT "server_scan_runs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "server_scan_runs_server_idx" ON "server_scan_runs" USING btree ("server_id");

-- Which server an application runs on, so live-facing findings land on it.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "server_id" uuid;
DO $$ BEGIN
 ALTER TABLE "repositories" ADD CONSTRAINT "repositories_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Uptime Kuma and Wazuh connection settings.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "kuma_base_url" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "kuma_api_key" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "wazuh_api_url" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "wazuh_user" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "wazuh_password" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "wazuh_ca_cert" text;
