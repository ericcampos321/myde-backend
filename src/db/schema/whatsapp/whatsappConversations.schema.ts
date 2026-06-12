import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.schema.js";
import { whatsappContacts } from "./whatsappContacts.schema.js";

export const whatsappConversations = pgTable(
  "whatsapp_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => whatsappContacts.id),
    status: text("status").notNull().default("open"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("whatsapp_conversations_tenant_contact_unique").on(
      table.tenantId,
      table.contactId
    ),
    index("whatsapp_conversations_tenant_last_message_idx").on(
      table.tenantId,
      table.lastMessageAt.desc()
    ),
    index("whatsapp_conversations_tenant_status_idx").on(
      table.tenantId,
      table.status
    ),
  ]
);

export type WhatsAppConversationRow = typeof whatsappConversations.$inferSelect;
export type NewWhatsAppConversationRow =
  typeof whatsappConversations.$inferInsert;
