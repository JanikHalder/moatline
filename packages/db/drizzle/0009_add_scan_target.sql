-- Which version a scan looked at. Until now every scan implicitly meant the
-- branch tip, so a CVE fixed on main read as fixed even while the deployed
-- commit still shipped the vulnerable version.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "target" text NOT NULL DEFAULT 'default';
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "ref" text;
