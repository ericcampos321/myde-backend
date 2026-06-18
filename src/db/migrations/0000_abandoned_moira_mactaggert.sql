CREATE TABLE "tenants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid () NOT NULL,
    "name" text NOT NULL,
    "phone_number_id" text NOT NULL,
    "waba_id" text,
    "created_at" timestamp
    with
        time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp
    with
        time zone DEFAULT now() NOT NULL
);

CREATE TABLE "whatsapp_contacts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid () NOT NULL,
    "tenant_id" uuid NOT NULL,
    "phone" text NOT NULL,
    "name" text,
    "created_at" timestamp
    with
        time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp
    with
        time zone DEFAULT now() NOT NULL
);

CREATE TABLE "whatsapp_conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid () NOT NULL,
    "tenant_id" uuid NOT NULL,
    "contact_id" uuid NOT NULL,
    "status" text DEFAULT 'open' NOT NULL,
    "last_message_at" timestamp
    with
        time zone,
        "created_at" timestamp
    with
        time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp
    with
        time zone DEFAULT now() NOT NULL
);

CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"external_message_id" text,
	"reply_to_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_direction_check" CHECK ("whatsapp_messages"."direction" in ('inbound', 'outbound'))
);

ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contact_id_whatsapp_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."whatsapp_contacts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_reply_to_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "tenants_phone_number_id_unique" ON "tenants" USING btree ("phone_number_id");

CREATE UNIQUE INDEX "whatsapp_contacts_tenant_phone_unique" ON "whatsapp_contacts" USING btree ("tenant_id", "phone");

CREATE INDEX "whatsapp_contacts_tenant_id_idx" ON "whatsapp_contacts" USING btree ("tenant_id");

CREATE UNIQUE INDEX "whatsapp_conversations_tenant_contact_unique" ON "whatsapp_conversations" USING btree ("tenant_id", "contact_id");

CREATE INDEX "whatsapp_conversations_tenant_last_message_idx" ON "whatsapp_conversations" USING btree (
    "tenant_id",
    "last_message_at" DESC NULLS LAST
);

CREATE INDEX "whatsapp_conversations_tenant_status_idx" ON "whatsapp_conversations" USING btree ("tenant_id", "status");

CREATE UNIQUE INDEX "whatsapp_messages_tenant_external_message_unique" ON "whatsapp_messages" USING btree ("tenant_id","external_message_id") WHERE "whatsapp_messages"."external_message_id" is not null;

CREATE UNIQUE INDEX "whatsapp_messages_tenant_reply_to_message_unique" ON "whatsapp_messages" USING btree ("tenant_id","reply_to_message_id") WHERE "whatsapp_messages"."reply_to_message_id" is not null;

CREATE INDEX "whatsapp_messages_tenant_conversation_created_idx" ON "whatsapp_messages" USING btree (
    "tenant_id",
    "conversation_id",
    "created_at"
);

CREATE INDEX "whatsapp_messages_tenant_external_message_idx" ON "whatsapp_messages" USING btree (
    "tenant_id",
    "external_message_id"
);