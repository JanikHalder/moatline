-- Repositories can be deployed by a Dokploy compose stack, not only an application.
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "dokploy_kind" text DEFAULT 'application' NOT NULL;
