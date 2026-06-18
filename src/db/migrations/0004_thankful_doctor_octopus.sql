CREATE TABLE "inbox_recent_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operator_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_recent_searches_target_type_check" CHECK ("inbox_recent_searches"."target_type" in ('conversation', 'contact'))
);

ALTER TABLE "inbox_recent_searches" ADD CONSTRAINT "inbox_recent_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "inbox_recent_searches_tenant_operator_target_unique" ON "inbox_recent_searches" USING btree (
    "tenant_id",
    "operator_id",
    "target_type",
    "target_id"
);

CREATE INDEX "inbox_recent_searches_tenant_operator_updated_idx" ON "inbox_recent_searches" USING btree (
    "tenant_id",
    "operator_id",
    "updated_at" DESC NULLS LAST
);