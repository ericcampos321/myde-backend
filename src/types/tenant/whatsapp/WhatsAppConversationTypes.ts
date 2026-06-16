/** Entrada do use case de upsert de conversa aberta. */
export interface UpsertOpenConversationInput {
  tenantId: string;
  contactId: string;
  lastMessageAt: Date | null;
}

/**
 * Read model da listagem de conversas (GET /conversations), montado em UMA query
 * no Postgres (ver `WhatsAppConversationRepository.listConversationSummaries`):
 * conversa + contato + última mensagem (preview) + última inbound + unread count
 * por operador. Substitui a carga de TODAS as mensagens do tenant em memória
 * (achado A-01 da auditoria). Tenant-scoped. Não expõe conteúdo além do preview
 * (`lastMessageBody`) que a listagem já exibia.
 */
export interface ConversationSummaryRow {
  id: string;
  contactId: string;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  contactName: string | null;
  contactPhone: string | null;
  lastMessageBody: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageStatus: string | null;
  lastInboundMessageId: string | null;
  lastInboundMessageAt: Date | null;
  unreadCount: number;
}
