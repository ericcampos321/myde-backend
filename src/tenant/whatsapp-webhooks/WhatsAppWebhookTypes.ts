export interface MetaWebhookVerificationQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export interface MetaWebhookHeaders {
  "x-hub-signature-256"?: string;
}

export interface MetaWebhookAckResponse {
  received: true;
}
