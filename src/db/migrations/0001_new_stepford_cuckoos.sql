ALTER TABLE "whatsapp_conversations"
DROP CONSTRAINT "whatsapp_conversations_contact_id_whatsapp_contacts_id_fk";

ALTER TABLE "whatsapp_messages"
DROP CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk";

ALTER TABLE "whatsapp_contacts"
ADD CONSTRAINT "whatsapp_contacts_id_tenant_unique" UNIQUE ("id", "tenant_id");

ALTER TABLE "whatsapp_conversations"
ADD CONSTRAINT "whatsapp_conversations_id_tenant_unique" UNIQUE ("id", "tenant_id");

ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contact_tenant_fk" FOREIGN KEY ("contact_id","tenant_id") REFERENCES "public"."whatsapp_contacts"("id","tenant_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."whatsapp_conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;