-- Self-healing and the incident history behind uptime.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "auto_heal" boolean DEFAULT false NOT NULL;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "live_failures" integer DEFAULT 0 NOT NULL;
CREATE TABLE IF NOT EXISTS "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE cascade,
  "kind" text DEFAULT 'site_down' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  "cause" text,
  "timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "heal_attempts" integer DEFAULT 0 NOT NULL,
  "healed_at" timestamp,
  "escalated_at" timestamp
);
CREATE INDEX IF NOT EXISTS "incidents_repo_time_idx" ON "incidents" ("repository_id", "started_at");
CREATE INDEX IF NOT EXISTS "incidents_org_open_idx" ON "incidents" ("organization_id", "resolved_at");
