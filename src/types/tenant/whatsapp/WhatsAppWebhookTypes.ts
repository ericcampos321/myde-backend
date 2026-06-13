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
  /**
   * Telefone REAL exibido da empresa (`metadata.display_phone_number`), quando a
   * Meta envia. Diferente de `phoneNumberId` (ID técnico). Usado na trava
   * anti-loop do auto-reply. Pode vir ausente em alguns eventos.
   */
  displayPhoneNumber: string | null;
  wabaId: string;
  externalMessageId: string;
  contactPhone: string;
  contactName: string | null;
  text: string;
  timestamp: Date;
}

/** Status de entrega de uma mensagem OUTBOUND (sent/delivered/read/failed). */
export interface NormalizedMessageStatus {
  /** wamid da mensagem outbound (= externalMessageId persistido). */
  messageId: string;
  status: string;
  /** Telefone do destinatário (statuses[].recipient_id). */
  recipientId: string | null;
  /** Epoch (segundos) do evento de status. */
  timestamp: string | null;
  errorCode: number | null;
  errorTitle: string | null;
  errorMessage: string | null;
  /** errors[].error_data.details — o motivo mais detalhado, quando a Meta envia. */
  errorDetails: string | null;
}

export type MetaWebhookMappingResult =
  | { kind: "message"; message: NormalizedInboundMessage }
  | {
      kind: "status";
      phoneNumberId: string | null;
      statuses: NormalizedMessageStatus[];
    }
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
      reason: "unsupported_event" | "unknown_tenant" | "status";
    };
