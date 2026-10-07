-- Backup freshness checks per server, live Nuclei progress, weekly digest.
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_checks" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "server_scan_runs" ADD COLUMN IF NOT EXISTS "progress" jsonb;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "weekly_digest" boolean DEFAULT true NOT NULL;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "last_digest_at" timestamp;
