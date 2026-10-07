-- New repositories are checked every night unless someone turns it off:
-- a schedule nobody sets is a site nobody checks. Existing rows keep theirs.
ALTER TABLE "repositories" ALTER COLUMN "scan_schedule" SET DEFAULT '0 3 * * *';
