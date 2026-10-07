-- The Dokploy service name of a repository's application: matches the
-- containers servers report, so image CVEs land on the right repository.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "dokploy_app_name" text;
