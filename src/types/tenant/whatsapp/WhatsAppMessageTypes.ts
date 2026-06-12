import type { NewWhatsAppMessage, WhatsAppMessage } from "../../../models/db/schema.js";

export type { NewWhatsAppMessage, WhatsAppMessage };
export type MessageDirection = WhatsAppMessage["direction"];

export interface CreateInboundMessageInput {
  tenantId: string;
  conversationId: string;
  body: string;
  externalMessageId: string;
  createdAt: Date;
}

export interface CreateOutboundMessageInput {
  tenantId: string;
  conversationId: string;
  body: string;
  replyToMessageId: string;
  status: string;
}
