ALTER TABLE "ai_interaction_logs"
DROP CONSTRAINT "ai_interaction_logs_stage_check";

ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_stage_check" CHECK ("ai_interaction_logs"."stage" in ('input', 'output', 'recurring', 'auto_reply'));