-- Accepted access (SSH keys, sudo/docker group members, uid-0 accounts):
-- new entries beyond it raise findings until accepted.
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "access_baseline" jsonb;
