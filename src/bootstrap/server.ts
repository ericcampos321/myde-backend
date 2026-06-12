import { buildApp } from "./app.js";
import { env } from "../config/env.js";
import { logger } from "../shared/logger/logger.js";
import { closeMessageProcessingQueue } from "../queues/message-processing/index.js";

/** Bootstrap do processo HTTP da API. */
async function start(): Promise<void> {
  const app = await buildApp();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "API recebendo sinal de shutdown");
    try {
      await closeMessageProcessingQueue();
      await app.close();
      logger.info("API encerrada com sucesso");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Falha ao encerrar a API");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    logger.info({ host: env.HOST, port: env.PORT }, "API myde-backend ouvindo");
  } catch (err) {
    logger.error({ err }, "Falha ao iniciar a API");
    process.exit(1);
  }
}

void start();
