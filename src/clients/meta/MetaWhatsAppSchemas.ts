import { z } from "zod";

export const SendTextParamsSchema = z.object({
  phoneNumberId: z.string().min(1, "phoneNumberId is required"),
  to: z.string().min(1, "to is required"),
  body: z.string().min(1, "body is required"),
});

export const SendTextResultSchema = z.object({
  externalMessageId: z.string().min(1, "externalMessageId is required"),
});

export type SendTextParams = z.infer<typeof SendTextParamsSchema>;
export type SendTextResult = z.infer<typeof SendTextResultSchema>;