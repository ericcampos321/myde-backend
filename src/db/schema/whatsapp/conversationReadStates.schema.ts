import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.schema.js";
import { whatsappConversations } from "./whatsappConversations.schema.js";
import { whatsappMessages } from "./whatsappMessages.schema.js";

export const conversationReadStates = pgTable(
  "conversation_read_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    operatorId: text("operator_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
    lastReadMessageId: uuid("last_read_message_id").references(
      () => whatsappMessages.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_read_states_tenant_conversation_operator_unique").on(
      table.tenantId,
      table.conversationId,
      table.operatorId
    ),
    index("conversation_read_states_tenant_operator_idx").on(
      table.tenantId,
      table.operatorId
    ),
    index("conversation_read_states_tenant_conversation_operator_idx").on(
      table.tenantId,
      table.conversationId,
      table.operatorId
    ),
    foreignKey({
      columns: [table.conversationId, table.tenantId],
      foreignColumns: [whatsappConversations.id, whatsappConversations.tenantId],
      name: "conversation_read_states_conversation_tenant_fk",
    }),
  ]
);

export type ConversationReadStateRow = typeof conversationReadStates.$inferSelect;
export type NewConversationReadStateRow = typeof conversationReadStates.$inferInsert;
