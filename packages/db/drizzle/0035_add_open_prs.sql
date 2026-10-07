-- Open pull requests of a repository on GitHub, refreshed every few minutes.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "open_prs" jsonb;
