export interface MetaWebhookVerificationQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export interface MetaWebhookHeaders {
  "x-hub-signature-256"?: string;
}

export interface NormalizedInboundMessage {
  phoneNumberId: string;
  wabaId: string;
  externalMessageId: string;
  contactPhone: string;
  contactName: string | null;
  text: string;
  timestamp: Date;
}

export type MetaWebhookMappingResult =
  | { kind: "message"; message: NormalizedInboundMessage }
  | { kind: "ignored"; reason: "unsupported_event" };

export type MetaWebhookAckResponse =
  | {
      received: true;
      persisted: true;
      duplicated: false;
    }
  | {
      received: true;
      persisted: false;
      duplicated: true;
    }
  | {
      received: true;
      ignored: true;
      reason: "unsupported_event" | "unknown_tenant";
    };
