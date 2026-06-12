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
import { tenants } from "../tenant/tenants.schema.js";
import { whatsappConversations } from "./whatsappConversations.schema.js";

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

export type WhatsAppMessageRow = typeof whatsappMessages.$inferSelect;
export type NewWhatsAppMessageRow = typeof whatsappMessages.$inferInsert;
