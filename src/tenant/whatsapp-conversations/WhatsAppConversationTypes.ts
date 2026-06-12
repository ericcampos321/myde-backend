export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
}
