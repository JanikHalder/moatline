-- Lets a scan whose process died be noticed in minutes, not hours.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
