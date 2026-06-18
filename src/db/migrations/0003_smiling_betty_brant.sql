CREATE TABLE "conversation_read_states" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid () NOT NULL,
    "tenant_id" uuid NOT NULL,
    "conversation_id" uuid NOT NULL,
    "operator_id" text NOT NULL,
    "last_read_at" timestamp
    with
        time zone NOT NULL,
        "last_read_message_id" uuid,
        "created_at" timestamp
    with
        time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp
    with
        time zone DEFAULT now() NOT NULL
);

ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_last_read_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."whatsapp_conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "conversation_read_states_tenant_conversation_operator_unique" ON "conversation_read_states" USING btree (
    "tenant_id",
    "conversation_id",
    "operator_id"
);

CREATE INDEX "conversation_read_states_tenant_operator_idx" ON "conversation_read_states" USING btree ("tenant_id", "operator_id");

CREATE INDEX "conversation_read_states_tenant_conversation_operator_idx" ON "conversation_read_states" USING btree (
    "tenant_id",
    "conversation_id",
    "operator_id"
);