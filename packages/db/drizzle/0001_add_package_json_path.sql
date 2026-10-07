ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "package_json_path" text NOT NULL DEFAULT 'package.json';
