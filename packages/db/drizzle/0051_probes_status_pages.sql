CREATE TABLE "probe_results" (
	"repository_id" uuid NOT NULL,
	"probe" text NOT NULL,
	"ok" boolean NOT NULL,
	"http_status" integer,
	"error" text,
	"duration_ms" integer,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "probe_results_repository_id_probe_pk" PRIMARY KEY("repository_id","probe")
);
--> statement-breakpoint
ALTER TABLE "probe_results" ADD CONSTRAINT "probe_results_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "status_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "status_pages_slug_idx" ON "status_pages" USING btree ("slug");
