-- Lighthouse runs of live sites (PageSpeed Insights) and the API key.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "pagespeed_api_key" text;
CREATE TABLE IF NOT EXISTS "perf_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE cascade,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "url" text NOT NULL,
  "strategy" text NOT NULL,
  "trigger" text DEFAULT 'schedule' NOT NULL,
  "commit" text,
  "error" text,
  "performance" integer,
  "accessibility" integer,
  "best_practices" integer,
  "seo" integer,
  "lcp_ms" integer,
  "cls" real,
  "tbt_ms" integer,
  "fcp_ms" integer,
  "ttfb_ms" integer,
  "bytes" integer,
  "field_lcp_ms" integer,
  "field_inp_ms" integer,
  "field_cls" real
);
CREATE INDEX IF NOT EXISTS "perf_runs_repo_time_idx" ON "perf_runs" ("repository_id", "created_at");
