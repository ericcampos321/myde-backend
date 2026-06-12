import {
  MESSAGE_PROCESSING_QUEUE,
  type MessageProcessingJobPayload,
} from "./MessageProcessingQueueTypes.js";

/**
 * Fila de processamento de mensagens (BullMQ).
 *
 * A implementação real (Queue singleton, enqueue por jobId=externalMessageId,
 * close gracioso) entra no commit "feat: add redis bullmq message queue".
 * Aqui ficam apenas os contratos para o webhook e o worker compilarem contra
 * a mesma assinatura.
 */
export async function enqueueMessageProcessing(
  _payload: MessageProcessingJobPayload
): Promise<void> {
  throw new Error(
    `[${MESSAGE_PROCESSING_QUEUE}] enqueue ainda não implementado`
  );
}

export async function closeMessageProcessingQueue(): Promise<void> {
  // No-op até a fila real existir.
}
