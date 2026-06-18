import type { NewTenantRow } from "../../../db/schema/index.js";

/** Entrada do use case de upsert de tenant (subconjunto da row de insert). */
export type UpsertWhatsAppTenantInput = Pick<
  NewTenantRow,
  "name" | "phoneNumberId" | "wabaId"
>;
