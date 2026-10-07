-- "New site" runs: repository, Dokploy app, database, backup, domain, monitoring.
CREATE TABLE IF NOT EXISTS "provision_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "input" jsonb,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp
);
CREATE INDEX IF NOT EXISTS "provision_runs_org_idx" ON "provision_runs" ("organization_id");
