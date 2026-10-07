-- One-time, short-lived enrollment codes for the one-line agent install.
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "enrollment_code_hash" text;
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "enrollment_expires_at" timestamp;
DO $$ BEGIN
 ALTER TABLE "servers" ADD CONSTRAINT "servers_enrollment_code_hash_unique" UNIQUE("enrollment_code_hash");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
