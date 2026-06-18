import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.schema.js";

export const inboxRecentSearches = pgTable(
  "inbox_recent_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    operatorId: text("operator_id").notNull(),
    targetType: text("target_type", {
      enum: ["conversation", "contact"],
    }).notNull(),
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "inbox_recent_searches_target_type_check",
      sql`${table.targetType} in ('conversation', 'contact')`
    ),
    uniqueIndex("inbox_recent_searches_tenant_operator_target_unique").on(
      table.tenantId,
      table.operatorId,
      table.targetType,
      table.targetId
    ),
    index("inbox_recent_searches_tenant_operator_updated_idx").on(
      table.tenantId,
      table.operatorId,
      table.updatedAt.desc()
    ),
  ]
);

export type InboxRecentSearchRow = typeof inboxRecentSearches.$inferSelect;
