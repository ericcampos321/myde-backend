import { z } from "zod";

export const UpsertWhatsAppTenantInputSchema = z.object({
  name: z.string().min(1, "tenant name is required").trim(),
  phoneNumberId: z.string().min(1, "phoneNumberId is required").trim(),
  wabaId: z.string().optional(),
});

export const WhatsAppTenantResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phoneNumberId: z.string(),
  wabaId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WhatsAppTenantResponse = z.infer<
  typeof WhatsAppTenantResponseSchema
>;