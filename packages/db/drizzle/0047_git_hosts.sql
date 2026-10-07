ALTER TABLE "org_integrations" ADD COLUMN "git_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL;
