-- Payload / Next.js / React / Node versions per repository, from its last scan.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "stack" jsonb;
