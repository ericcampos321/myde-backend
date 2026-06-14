CREATE TABLE "ai_interaction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid,
	"operator_id" text,
	"stage" text NOT NULL,
	"action" text NOT NULL,
	"risk_level" text NOT NULL,
	"risk_reasons" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"matched_rules" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"source" text,
	"prompt_version" text,
	"input_char_count" integer DEFAULT 0 NOT NULL,
	"output_char_count" integer,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_interaction_logs_stage_check" CHECK ("ai_interaction_logs"."stage" in ('input', 'output', 'recurring')),
	CONSTRAINT "ai_interaction_logs_action_check" CHECK ("ai_interaction_logs"."action" in ('allow', 'flag', 'block')),
	CONSTRAINT "ai_interaction_logs_risk_level_check" CHECK ("ai_interaction_logs"."risk_level" in ('low', 'medium', 'high')),
	CONSTRAINT "ai_interaction_logs_input_char_count_non_negative_check" CHECK ("ai_interaction_logs"."input_char_count" >= 0),
	CONSTRAINT "ai_interaction_logs_output_char_count_non_negative_check" CHECK ("ai_interaction_logs"."output_char_count" is null or "ai_interaction_logs"."output_char_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."whatsapp_conversations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_contact_tenant_fk" FOREIGN KEY ("contact_id","tenant_id") REFERENCES "public"."whatsapp_contacts"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_interaction_logs_tenant_created_at_idx" ON "ai_interaction_logs" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_interaction_logs_conversation_created_at_idx" ON "ai_interaction_logs" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_interaction_logs_tenant_conversation_created_at_idx" ON "ai_interaction_logs" USING btree ("tenant_id","conversation_id","created_at" DESC NULLS LAST);