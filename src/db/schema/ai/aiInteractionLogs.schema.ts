import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.schema.js";
import { whatsappContacts } from "../whatsapp/whatsappContacts.schema.js";
import { whatsappConversations } from "../whatsapp/whatsappConversations.schema.js";

export const aiInteractionLogs = pgTable(
  "ai_interaction_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    contactId: uuid("contact_id"),
    operatorId: text("operator_id"),
    stage: text("stage", {
      enum: ["input", "output", "recurring"],
    }).notNull(),
    action: text("action", {
      enum: ["allow", "flag", "block"],
    }).notNull(),
    riskLevel: text("risk_level", {
      enum: ["low", "medium", "high"],
    }).notNull(),
    riskReasons: text("risk_reasons")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    matchedRules: text("matched_rules")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    blocked: boolean("blocked").notNull().default(false),
    source: text("source", {
      enum: ["openai", "stub"],
    }),
    promptVersion: text("prompt_version"),
    inputCharCount: integer("input_char_count").notNull().default(0),
    outputCharCount: integer("output_char_count"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "ai_interaction_logs_stage_check",
      sql`${table.stage} in ('input', 'output', 'recurring')`
    ),
    check(
      "ai_interaction_logs_action_check",
      sql`${table.action} in ('allow', 'flag', 'block')`
    ),
    check(
      "ai_interaction_logs_risk_level_check",
      sql`${table.riskLevel} in ('low', 'medium', 'high')`
    ),
    check(
      "ai_interaction_logs_input_char_count_non_negative_check",
      sql`${table.inputCharCount} >= 0`
    ),
    check(
      "ai_interaction_logs_output_char_count_non_negative_check",
      sql`${table.outputCharCount} is null or ${table.outputCharCount} >= 0`
    ),
    index("ai_interaction_logs_tenant_created_at_idx").on(
      table.tenantId,
      table.createdAt.desc()
    ),
    index("ai_interaction_logs_conversation_created_at_idx").on(
      table.conversationId,
      table.createdAt.desc()
    ),
    index("ai_interaction_logs_tenant_conversation_created_at_idx").on(
      table.tenantId,
      table.conversationId,
      table.createdAt.desc()
    ),
    foreignKey({
      columns: [table.conversationId, table.tenantId],
      foreignColumns: [whatsappConversations.id, whatsappConversations.tenantId],
      name: "ai_interaction_logs_conversation_tenant_fk",
    }),
    foreignKey({
      columns: [table.contactId, table.tenantId],
      foreignColumns: [whatsappContacts.id, whatsappContacts.tenantId],
      name: "ai_interaction_logs_contact_tenant_fk",
    }),
  ]
);

export type AiInteractionLogRow = typeof aiInteractionLogs.$inferSelect;
export type NewAiInteractionLogRow = typeof aiInteractionLogs.$inferInsert;
