export type MessageDirection = "inbound" | "outbound";

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  body: string;
  status: string;
  externalMessageId: string | null;
  replyToMessageId: string | null;
  createdAt: string;
}
