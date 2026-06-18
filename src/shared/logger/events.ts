/**
 * Nomes canônicos de evento para logs estruturados (campo `event`).
 *
 * Centralizados para evitar typos e permitir filtrar um atendimento ponta a ponta
 * (ex.: `event:"message_processing.completed" AND externalMessageId:"wamid..."`).
 * Apenas a string canônica — os campos de correlação (tenantId, conversationId,
 * messageId, externalMessageId, jobId, phoneNumberId, requestId/correlationId,
 * durationMs) são adicionados em cada call site.
 */
export const LogEvents = {
  webhook: {
    received: "webhook.received",
    verified: "webhook.verified",
    signatureInvalid: "webhook.signature.invalid",
    inboundPersisted: "webhook.inbound.persisted",
    inboundDuplicated: "webhook.inbound.duplicated",
    // A-03: reparo idempotente do job quando o webhook chega duplicado.
    reenqueueAttempted: "webhook.inbound.reenqueue_attempted",
    reenqueueSkipped: "webhook.inbound.reenqueue_skipped",
    reenqueueFailed: "webhook.inbound.reenqueue_failed",
    ignoredUnknownTenant: "webhook.ignored.unknown_tenant",
    ignoredUnsupported: "webhook.ignored.unsupported",
    statusReceived: "webhook.status.received",
  },
  messageProcessing: {
    enqueued: "message_processing.enqueued",
    started: "message_processing.started",
    completed: "message_processing.completed",
    failed: "message_processing.failed",
    stalled: "message_processing.stalled",
  },
  ai: {
    suggestionStarted: "ai.suggestion.started",
    suggestionCompleted: "ai.suggestion.completed",
    suggestionBlocked: "ai.suggestion.blocked",
  },
  meta: {
    outboundStarted: "meta.outbound.started",
    outboundCompleted: "meta.outbound.completed",
    outboundFailed: "meta.outbound.failed",
  },
  health: {
    readinessChecked: "health.readiness.checked",
  },
} as const;
