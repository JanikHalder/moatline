-- Errors apps log (scrubbed, grouped by message) and how often per report.
CREATE TABLE IF NOT EXISTS "log_errors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE cascade,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE set null,
  "app" text NOT NULL,
  "fingerprint" text NOT NULL,
  "sample" text NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "first_seen" timestamp DEFAULT now() NOT NULL,
  "last_seen" timestamp DEFAULT now() NOT NULL,
  "notified_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "log_errors_server_fp_idx" ON "log_errors" ("server_id", "fingerprint");
CREATE INDEX IF NOT EXISTS "log_errors_repo_idx" ON "log_errors" ("repository_id", "last_seen");
CREATE TABLE IF NOT EXISTS "log_error_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "error_id" uuid NOT NULL REFERENCES "log_errors"("id") ON DELETE cascade,
  "recorded_at" timestamp DEFAULT now() NOT NULL,
  "count" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "log_error_counts_error_time_idx" ON "log_error_counts" ("error_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "log_error_counts_time_idx" ON "log_error_counts" ("recorded_at");
