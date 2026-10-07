ALTER TABLE "package_findings" ADD COLUMN IF NOT EXISTS "unused" boolean NOT NULL DEFAULT false;
