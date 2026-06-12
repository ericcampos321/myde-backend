import type {
  NewWhatsAppContact,
  WhatsAppContact,
} from "../../../models/db/schema.js";

export type { NewWhatsAppContact, WhatsAppContact };

export type UpsertWhatsAppContactInput = Pick<
  NewWhatsAppContact,
  "tenantId" | "phone" | "name"
>;
