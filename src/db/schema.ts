import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    wabaId: text("waba_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tenants_phone_number_id_unique").on(table.phoneNumberId),
  ]
);

export const whatsappContacts = pgTable(
  "whatsapp_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    phone: text("phone").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("whatsapp_contacts_tenant_phone_unique").on(
      table.tenantId,
      table.phone
    ),
    index("whatsapp_contacts_tenant_id_idx").on(table.tenantId),
  ]
);

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

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => whatsappConversations.id),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    body: text("body").notNull(),
    status: text("status").notNull(),
    externalMessageId: text("external_message_id"),
    replyToMessageId: uuid("reply_to_message_id").references(
      (): AnyPgColumn => whatsappMessages.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "whatsapp_messages_direction_check",
      sql`${table.direction} in ('inbound', 'outbound')`
    ),
    uniqueIndex("whatsapp_messages_tenant_external_message_unique")
      .on(table.tenantId, table.externalMessageId)
      .where(sql`${table.externalMessageId} is not null`),
    uniqueIndex("whatsapp_messages_tenant_reply_to_message_unique")
      .on(table.tenantId, table.replyToMessageId)
      .where(sql`${table.replyToMessageId} is not null`),
    index("whatsapp_messages_tenant_conversation_created_idx").on(
      table.tenantId,
      table.conversationId,
      table.createdAt
    ),
    index("whatsapp_messages_tenant_external_message_idx").on(
      table.tenantId,
      table.externalMessageId
    ),
  ]
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type WhatsAppContact = typeof whatsappContacts.$inferSelect;
export type NewWhatsAppContact = typeof whatsappContacts.$inferInsert;
export type WhatsAppConversation = typeof whatsappConversations.$inferSelect;
export type NewWhatsAppConversation = typeof whatsappConversations.$inferInsert;
export type WhatsAppMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsAppMessage = typeof whatsappMessages.$inferInsert;
