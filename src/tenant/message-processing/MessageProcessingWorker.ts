import { createLogger } from "../../shared/logger/logger.js";
import { installWorkerShutdown } from "./MessageProcessingWorkerRuntime.js";
import {
  closeMessageProcessingQueue,
  MESSAGE_PROCESSING_QUEUE,
} from "./index.js";

/**
 * Processo dedicado do worker de mensagens.
 *
 * Nesta fundação ele apenas sobe, registra shutdown gracioso e fica vivo —
 * o consumo real do BullMQ entra no commit do worker. Mantém o processo
 * separado da API desde o início.
 */
const log = createLogger({ module: "worker", queue: MESSAGE_PROCESSING_QUEUE });

async function bootstrap(): Promise<void> {
  log.info("worker de processamento iniciado (sem consumir fila ainda)");

  installWorkerShutdown(log, async () => {
    await closeMessageProcessingQueue();
  });

  // Mantém o processo vivo até receber sinal de shutdown.
  // Substituído pelo consumidor BullMQ (que mantém o event loop ativo) no
  // commit da fila real.
  await new Promise<void>(() => {});
}

void bootstrap();
