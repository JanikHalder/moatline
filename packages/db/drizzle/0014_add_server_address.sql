-- Agentless external check: a public address whose open ports and TLS
-- certificate are checked from the outside.
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "expected_ports" jsonb DEFAULT '[80,443]'::jsonb NOT NULL;
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "network_state" jsonb;
