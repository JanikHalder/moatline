-- When a finding will be resolved by the server's own automation
-- (unattended-upgrades, a scheduled reboot): watch it, don't act on it.
ALTER TABLE "server_findings" ADD COLUMN IF NOT EXISTS "auto_fix_at" timestamp;
