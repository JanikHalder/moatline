-- Lets a fix or update run whose process died be noticed in minutes.
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
