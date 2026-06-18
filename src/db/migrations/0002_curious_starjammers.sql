ALTER TABLE "whatsapp_messages" ADD COLUMN "failure_code" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "failed_at" timestamp with time zone;