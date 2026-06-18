import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
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
    contactId: uuid("contact_id").notNull(),
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
    // FK composta: o contato referenciado deve pertencer ao MESMO tenant.
    // Impede que uma conversa do tenant A aponte para contato do tenant B.
    foreignKey({
      columns: [table.contactId, table.tenantId],
      foreignColumns: [whatsappContacts.id, whatsappContacts.tenantId],
      name: "whatsapp_conversations_contact_tenant_fk",
    }),
    // Alvo de FK composta: garante que (id, tenantId) é único, permitindo que
    // mensagens referenciem a conversa amarrando o tenant no nível do banco.
    unique("whatsapp_conversations_id_tenant_unique").on(
      table.id,
      table.tenantId
    ),
  ]
);

export type WhatsAppConversationRow = typeof whatsappConversations.$inferSelect;
export type NewWhatsAppConversationRow =
  typeof whatsappConversations.$inferInsert;
