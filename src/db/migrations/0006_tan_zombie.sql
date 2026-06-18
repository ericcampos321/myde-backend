ALTER TABLE "ai_interaction_logs" ADD COLUMN "provider" text;

ALTER TABLE "ai_interaction_logs" ADD COLUMN "prompt_tokens" integer;

ALTER TABLE "ai_interaction_logs"
ADD COLUMN "completion_tokens" integer;

ALTER TABLE "ai_interaction_logs" ADD COLUMN "total_tokens" integer;

ALTER TABLE "ai_interaction_logs" ADD COLUMN "duration_ms" integer;

ALTER TABLE "ai_interaction_logs"
ADD COLUMN "context_items_count" integer;

ALTER TABLE "ai_interaction_logs" ADD COLUMN "context_chars" integer;