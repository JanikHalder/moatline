-- How fixes and updates are checked before their PR. Builds of apps that
-- need a database cannot pass in an isolated clone; a typecheck can.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "verify_mode" text DEFAULT 'typecheck' NOT NULL;
