import type {
  NewWhatsAppConversation,
  WhatsAppConversation,
} from "../../db/schema.js";

export type { NewWhatsAppConversation, WhatsAppConversation };

export interface UpsertOpenConversationInput {
  tenantId: string;
  contactId: string;
  lastMessageAt: Date | null;
}
