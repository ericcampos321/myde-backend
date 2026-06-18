import Fastify, { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { loggerOptions } from "../shared/logger/logger.js";
import { httpErrorHandler } from "../errors/HttpError.js";
import { registerCors } from "../plugins/cors.plugin.js";
import { registerSensible } from "../plugins/sensible.plugin.js";
import { registerRawBody } from "../plugins/raw-body.plugin.js";
import {
  registerRoutes,
  type RegisterRoutesOptions,
} from "../routes/index.js";

/**
 * Monta a instância Fastify com plugins e rotas, sem subir o listener.
 * Mantida fina: orquestra registros e delega regra de negócio aos módulos.
 */
export type BuildAppOptions = RegisterRoutesOptions;

export async function buildApp(
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: env.NODE_ENV === "test",
  });

  await registerRawBody(app);
  await registerCors(app);
  await registerSensible(app);

  app.setErrorHandler(httpErrorHandler);

  await registerRoutes(app, options);

  return app;
}
