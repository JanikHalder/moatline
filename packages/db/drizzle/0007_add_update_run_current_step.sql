-- Fine-grained phase inside an update run's status ("clone", "install",
-- "build", …). Without it the UI shows one status for the several minutes a
-- run spends installing and building, and looks stuck.
ALTER TABLE "update_runs" ADD COLUMN IF NOT EXISTS "current_step" text;
