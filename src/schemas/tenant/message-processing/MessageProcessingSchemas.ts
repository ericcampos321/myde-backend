import { z } from "zod";

export const MessageProcessingJobPayloadSchema = z.object({
  tenantId: z.string().uuid("invalid tenantId"),
  conversationId: z.string().uuid("invalid conversationId"),
  messageId: z.string().uuid("invalid messageId"),
  externalMessageId: z.string().min(1, "externalMessageId is required"),
  phoneNumberId: z.string().min(1, "phoneNumberId is required"),
  contactPhone: z.string().min(1, "contactPhone is required"),
});

export const MessageProcessingResultSchema = z.object({
  processed: z.boolean(),
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  aiResponseText: z.string().optional(),
  aiSource: z.enum(["openai", "stub"]).optional(),
  skipped: z.boolean().optional(),
  reason: z
    .enum([
      "message_not_found",
      "conversation_not_found",
      "invalid_payload",
    ])
    .optional(),
});

export const EnqueueInboundMessageResultSchema = z.object({
  jobId: z.string(),
  jobName: z.literal("process-inbound-message"),
});

export type MessageProcessingJobPayload = z.infer<
  typeof MessageProcessingJobPayloadSchema
>;
export type MessageProcessingResult = z.infer<
  typeof MessageProcessingResultSchema
>;
export type EnqueueInboundMessageResult = z.infer<
  typeof EnqueueInboundMessageResultSchema
>;