ALTER TABLE "ai_interaction_logs"
ADD COLUMN "cached_prompt_tokens" integer;

ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_cached_prompt_tokens_non_negative_check" CHECK ("ai_interaction_logs"."cached_prompt_tokens" is null or "ai_interaction_logs"."cached_prompt_tokens" >= 0);