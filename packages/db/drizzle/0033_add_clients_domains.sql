-- Customers of the agency, and the domains checked for certificate,
-- registration and mail DNS.
CREATE TABLE IF NOT EXISTS "clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "contact_email" text,
  "language" text DEFAULT 'de' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "clients_organization_id_idx" ON "clients" ("organization_id");
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "client_id" uuid REFERENCES "clients"("id") ON DELETE set null;
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "client_id" uuid REFERENCES "clients"("id") ON DELETE set null;
CREATE TABLE IF NOT EXISTS "domains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE set null,
  "name" text NOT NULL,
  "source" text DEFAULT 'auto' NOT NULL,
  "checked_at" timestamp,
  "state" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "domains_org_name_idx" ON "domains" ("organization_id", "name");
