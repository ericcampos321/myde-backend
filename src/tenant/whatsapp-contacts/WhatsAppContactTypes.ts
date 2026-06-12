import type {
  NewWhatsAppContact,
  WhatsAppContact,
} from "../../db/schema.js";

export type { NewWhatsAppContact, WhatsAppContact };

export type UpsertWhatsAppContactInput = Pick<
  NewWhatsAppContact,
  "tenantId" | "phone" | "name"
>;
