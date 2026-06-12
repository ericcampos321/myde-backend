/** Nome da fila BullMQ de processamento de mensagens inbound. */
export const MESSAGE_PROCESSING_QUEUE = "message-processing" as const;
export const PROCESS_INBOUND_MESSAGE_JOB = "process-inbound-message" as const;

export type MessageProcessingJobPayload = {
  tenantId: string;
  conversationId: string;
  messageId: string;
  externalMessageId: string;
  phoneNumberId: string;
  contactPhone: string;
};

export interface MessageProcessingResult {
  processed: boolean;
  messageId: string;
  conversationId: string;
  aiResponseText?: string;
  aiSource?: "openai" | "stub";
  skipped?: boolean;
  reason?: "message_not_found" | "conversation_not_found" | "invalid_payload";
}

export interface EnqueueInboundMessageResult {
  jobId: string;
  jobName: typeof PROCESS_INBOUND_MESSAGE_JOB;
}

export interface MessageProcessingQueuePort {
  enqueueInboundMessage(
    payload: MessageProcessingJobPayload
  ): Promise<EnqueueInboundMessageResult>;
}
