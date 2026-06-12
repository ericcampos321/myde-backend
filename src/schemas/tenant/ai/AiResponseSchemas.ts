import { z } from "zod";

export const AiSourceSchema = z.enum(["openai", "stub"]);

export const AiConversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "content is required"),
});

export const AiProviderInputSchema = z.object({
  systemPrompt: z.string().min(1, "systemPrompt is required"),
  knowledgeBaseContext: z.string(),
  conversationHistory: z.array(AiConversationTurnSchema),
  userMessage: z.string().min(1, "userMessage is required"),
});

export const AiProviderResultSchema = z.object({
  text: z.string(),
  source: AiSourceSchema,
});

export const AiResponseConversationMessageSchema = z.object({
  direction: z.enum(["inbound", "outbound"]),
  body: z.string().min(1, "body is required"),
});

export const AiResponseInputSchema = z.object({
  currentMessage: z.string().min(1, "currentMessage is required"),
  conversationHistory: z.array(AiResponseConversationMessageSchema),
});

export const AiResponseResultSchema = z.object({
  text: z.string(),
  source: AiSourceSchema,
});

export type AiSource = z.infer<typeof AiSourceSchema>;
export type AiConversationTurn = z.infer<typeof AiConversationTurnSchema>;
export type AiProviderInput = z.infer<typeof AiProviderInputSchema>;
export type AiProviderResult = z.infer<typeof AiProviderResultSchema>;
export type AiResponseConversationMessage = z.infer<
  typeof AiResponseConversationMessageSchema
>;
export type AiResponseInput = z.infer<typeof AiResponseInputSchema>;
export type AiResponseResult = z.infer<typeof AiResponseResultSchema>;