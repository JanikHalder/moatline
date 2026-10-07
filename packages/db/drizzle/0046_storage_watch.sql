ALTER TABLE "servers" ADD COLUMN "storage_checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "storage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"key" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"used_bytes" bigint NOT NULL,
	"total_bytes" bigint
);
--> statement-breakpoint
ALTER TABLE "storage_metrics" ADD CONSTRAINT "storage_metrics_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_metrics_server_key_time_idx" ON "storage_metrics" USING btree ("server_id","key","recorded_at");--> statement-breakpoint
CREATE INDEX "storage_metrics_time_idx" ON "storage_metrics" USING btree ("recorded_at");
