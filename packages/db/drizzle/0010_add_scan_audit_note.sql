-- Why a scan has no vulnerability data. Without it, an audit that could not
-- run at all is indistinguishable from a clean result.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "audit_note" text;
