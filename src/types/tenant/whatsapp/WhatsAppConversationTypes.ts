import type {
  NewWhatsAppConversation,
  WhatsAppConversation,
} from "../../../models/db/schema.js";

export type { NewWhatsAppConversation, WhatsAppConversation };

export interface UpsertOpenConversationInput {
  tenantId: string;
  contactId: string;
  lastMessageAt: Date | null;
}
