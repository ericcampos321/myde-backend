import { z } from "zod";

export const CreateInboundMessageInputSchema = z.object({
  tenantId: z.string().uuid("invalid tenantId"),
  conversationId: z.string().uuid("invalid conversationId"),
  body: z.string().min(1, "body is required"),
  externalMessageId: z.string().min(1, "externalMessageId is required"),
  createdAt: z.date(),
});

export const CreateOutboundMessageInputSchema = z.object({
  tenantId: z.string().uuid("invalid tenantId"),
  conversationId: z.string().uuid("invalid conversationId"),
  body: z.string().min(1, "body is required"),
  replyToMessageId: z.string().uuid("invalid replyToMessageId"),
  status: z.string().min(1, "status is required"),
});

export const WhatsAppMessageResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  status: z.string(),
  externalMessageId: z.string().nullable(),
  replyToMessageId: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WhatsAppMessageResponse = z.infer<
  typeof WhatsAppMessageResponseSchema
>;
