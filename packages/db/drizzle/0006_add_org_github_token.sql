-- Per-organization GitHub token, AES-256-GCM encrypted like the other
-- integration secrets. Falls back to the server-wide GITHUB_TOKEN when unset.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "github_token" text;
