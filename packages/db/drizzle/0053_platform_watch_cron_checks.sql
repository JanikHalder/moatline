ALTER TABLE "org_integrations" ADD COLUMN "platform_watch" jsonb;--> statement-breakpoint
CREATE TABLE "cron_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"period_seconds" integer NOT NULL,
	"grace_seconds" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"last_ping_at" timestamp,
	"last_start_at" timestamp,
	"down_since" timestamp,
	"pings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cron_checks" ADD CONSTRAINT "cron_checks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cron_checks_token_idx" ON "cron_checks" USING btree ("token");--> statement-breakpoint
CREATE INDEX "cron_checks_org_idx" ON "cron_checks" USING btree ("organization_id");
