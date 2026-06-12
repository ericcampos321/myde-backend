import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "../tenant/tenants.schema.js";

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

export type WhatsAppContactRow = typeof whatsappContacts.$inferSelect;
export type NewWhatsAppContactRow = typeof whatsappContacts.$inferInsert;
