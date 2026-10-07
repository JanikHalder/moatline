-- Language of notifications per organization.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "notify_language" text DEFAULT 'en' NOT NULL;
