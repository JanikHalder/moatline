-- Better Auth writes createdAt/updatedAt on verification rows and orders by
-- createdAt when looking a token up. Without these columns password resets
-- fail at token creation.
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
