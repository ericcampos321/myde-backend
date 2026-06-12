import type { NewTenant, Tenant } from "../../db/schema.js";

export type { NewTenant, Tenant };
export type UpsertWhatsAppTenantInput = Pick<
  NewTenant,
  "name" | "phoneNumberId" | "wabaId"
>;
