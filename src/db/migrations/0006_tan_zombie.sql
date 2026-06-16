ALTER TABLE "ai_interaction_logs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD COLUMN "completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD COLUMN "context_items_count" integer;--> statement-breakpoint
ALTER TABLE "ai_interaction_logs" ADD COLUMN "context_chars" integer;