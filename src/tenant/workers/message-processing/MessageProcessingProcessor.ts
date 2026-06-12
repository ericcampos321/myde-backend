import type { Logger } from "pino";
import type { MessageProcessingJobPayload } from "../../queues/message-processing/MessageProcessingQueueTypes.js";

/**
 * Lógica pura de processamento de um job de mensagem.
 *
 * Implementação real (carregar conversa + histórico, montar contexto com
 * knowledge-base, chamar AiProvider, persistir outbound idempotente, enviar
 * via MetaWhatsAppClient) entra nos commits de worker/AI/meta. Placeholder.
 */
export async function processMessageJob(
  _payload: MessageProcessingJobPayload,
  _log: Logger
): Promise<void> {
  throw new Error("processMessageJob ainda não implementado");
}
