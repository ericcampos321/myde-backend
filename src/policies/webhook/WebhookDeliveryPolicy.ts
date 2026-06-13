import type { MetaWebhookAckResponse } from "../../types/tenant/whatsapp/WhatsAppWebhookTypes.js";

/**
 * Vocabulário centralizado de razões de ignore expostas no ACK do webhook.
 * (Duplicidade não é uma "razão" e sim o flag `duplicated: true` no ACK.)
 */
export const WEBHOOK_IGNORED_REASONS = {
  UNKNOWN_TENANT: "unknown_tenant",
  UNSUPPORTED_EVENT: "unsupported_event",
  STATUS: "status",
} as const;

export type WebhookIgnoredReason =
  (typeof WEBHOOK_IGNORED_REASONS)[keyof typeof WEBHOOK_IGNORED_REASONS];

/**
 * Decide o ACK seguro para a Meta. Todos os caminhos retornam `received: true`
 * (HTTP 200) de propósito: confirmar o recebimento evita retry infinito da Meta
 * para eventos que não devemos ou não conseguimos processar. A assinatura
 * inválida é rejeitada ANTES, no SignatureService — nunca chega aqui.
 * Não conhece HMAC, SQL, BullMQ nem IA.
 */
export class WebhookDeliveryPolicy {
  /** Tenant desconhecido/ausente: confirma e ignora. */
  static ignoredUnknownTenant(): MetaWebhookAckResponse {
    return {
      received: true,
      ignored: true,
      reason: WEBHOOK_IGNORED_REASONS.UNKNOWN_TENANT,
    };
  }

  /** Evento sem mensagem de texto suportada: confirma e ignora. */
  static ignoredUnsupportedEvent(): MetaWebhookAckResponse {
    return {
      received: true,
      ignored: true,
      reason: WEBHOOK_IGNORED_REASONS.UNSUPPORTED_EVENT,
    };
  }

  /** Evento de status de entrega de outbound (statuses[]): confirma e ignora. */
  static ignoredStatusEvent(): MetaWebhookAckResponse {
    return {
      received: true,
      ignored: true,
      reason: WEBHOOK_IGNORED_REASONS.STATUS,
    };
  }

  /** Mensagem já persistida antes (idempotência): confirma sem repersistir. */
  static duplicated(): MetaWebhookAckResponse {
    return { received: true, persisted: false, duplicated: true };
  }

  /** Mensagem nova persistida e enfileirada com sucesso. */
  static persisted(): MetaWebhookAckResponse {
    return { received: true, persisted: true, duplicated: false };
  }
}
