import type { NewWhatsAppContactRow } from "../../../db/schema/index.js";

/** Entrada do use case de upsert de contato (subconjunto da row de insert). */
export type UpsertWhatsAppContactInput = Pick<
  NewWhatsAppContactRow,
  "tenantId" | "phone" | "name"
>;
