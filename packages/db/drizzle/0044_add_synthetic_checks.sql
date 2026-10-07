-- User journeys checked against live URLs.
CREATE TABLE IF NOT EXISTS "synthetic_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "steps" jsonb NOT NULL,
  "secrets" text,
  "interval_minutes" integer DEFAULT 15 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_run_at" timestamp,
  "last_ok" boolean,
  "last_result" jsonb,
  "failures" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "synthetic_checks_repo_idx" ON "synthetic_checks" ("repository_id");
