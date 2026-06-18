import type { WhatsAppMessageRow } from "../../../db/schema/index.js";

export type MessageDirection = WhatsAppMessageRow["direction"];

/** Entrada do use case de criação de mensagem inbound (idempotente). */
export interface CreateInboundMessageInput {
  tenantId: string;
  conversationId: string;
  body: string;
  externalMessageId: string;
  createdAt: Date;
}

/** Entrada do use case de criação de mensagem outbound. */
export interface CreateOutboundMessageInput {
  tenantId: string;
  conversationId: string;
  body: string;
  replyToMessageId: string;
  status: string;
}
