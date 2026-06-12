/** Entrada do use case de upsert de conversa aberta. */
export interface UpsertOpenConversationInput {
  tenantId: string;
  contactId: string;
  lastMessageAt: Date | null;
}
