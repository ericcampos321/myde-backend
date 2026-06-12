import Fastify, { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { loggerOptions } from "../shared/logger/logger.js";
import { httpErrorHandler } from "../shared/errors/HttpError.js";
import { registerCors } from "../plugins/cors.plugin.js";
import { registerSensible } from "../plugins/sensible.plugin.js";
import { registerRawBody } from "../plugins/raw-body.plugin.js";
import { healthController } from "../controllers/api/health/index.js";
import { whatsAppWebhookController } from "../tenant/whatsapp-webhooks/index.js";

/**
 * Monta a instância Fastify com plugins e rotas, sem subir o listener.
 * Mantida fina: orquestra registros e delega regra de negócio aos módulos.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: env.NODE_ENV === "test",
  });

  await registerRawBody(app);
  await registerCors(app);
  await registerSensible(app);

  app.setErrorHandler(httpErrorHandler);

  await app.register(healthController);
  await app.register(whatsAppWebhookController);

  return app;
}
