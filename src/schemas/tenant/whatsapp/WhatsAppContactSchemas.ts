import { z } from "zod";

export const UpsertWhatsAppContactInputSchema = z.object({
  tenantId: z.string().uuid("invalid tenantId"),
  phone: z.string().min(1, "phone is required").trim(),
  name: z.string().optional(),
});

export const WhatsAppContactResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WhatsAppContactResponse = z.infer<
  typeof WhatsAppContactResponseSchema
>;