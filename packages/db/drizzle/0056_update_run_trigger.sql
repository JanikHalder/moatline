ALTER TABLE "update_runs" ADD COLUMN "trigger_source" text;--> statement-breakpoint
ALTER TABLE "update_runs" ADD COLUMN "trigger_detail" jsonb;
