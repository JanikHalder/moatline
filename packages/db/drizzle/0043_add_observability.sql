-- Events out to observability tools, alerts in.
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "otlp_endpoint" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "otlp_headers" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "grafana_url" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "grafana_token" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "event_webhook_url" text;
ALTER TABLE "org_integrations" ADD COLUMN IF NOT EXISTS "alert_token_hash" text;
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "external_id" text;
CREATE INDEX IF NOT EXISTS "org_integrations_alert_token_idx" ON "org_integrations" ("alert_token_hash");
