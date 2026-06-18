ALTER TABLE "whatsapp_messages" ADD COLUMN "failure_code" integer;

ALTER TABLE "whatsapp_messages" ADD COLUMN "failure_reason" text;

ALTER TABLE "whatsapp_messages"
ADD COLUMN "failed_at" timestamp
with
    time zone;