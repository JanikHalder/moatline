-- Memory and CPU per app, and each server's usual values per app.
CREATE TABLE IF NOT EXISTS "container_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"app" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"mem_bytes" bigint NOT NULL,
	"cpu_pct" real
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "container_metrics" ADD CONSTRAINT "container_metrics_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_metrics_server_app_time_idx" ON "container_metrics" USING btree ("server_id","app","recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_metrics_time_idx" ON "container_metrics" USING btree ("recorded_at");--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "workload_baseline" jsonb;
