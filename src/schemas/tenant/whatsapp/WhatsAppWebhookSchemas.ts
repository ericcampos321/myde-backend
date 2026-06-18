export const metaWebhookVerificationQuerySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    "hub.mode": { type: "string" },
    "hub.verify_token": { type: "string" },
    "hub.challenge": { type: "string" },
  },
} as const;

export const metaWebhookHeadersSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    "x-hub-signature-256": { type: "string" },
  },
} as const;
