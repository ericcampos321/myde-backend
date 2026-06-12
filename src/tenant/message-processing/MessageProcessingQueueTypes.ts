/** Nome da fila BullMQ de processamento de mensagens inbound. */
export const MESSAGE_PROCESSING_QUEUE = "message-processing" as const;

/**
 * Payload do job de processamento de uma mensagem inbound.
 * jobId = externalMessageId garante deduplicação nativa no BullMQ.
 */
export interface MessageProcessingJobPayload {
  tenantId: string;
  conversationId: string;
  messageId: string;
  externalMessageId: string;
  phoneNumberId: string;
  contactPhone: string;
}
