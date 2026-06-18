import { pino, type Logger, type LoggerOptions } from "pino";
import { env } from "../../config/env.js";

/**
 * Opções de logging compartilhadas. Pretty-print apenas em desenvolvimento;
 * JSON puro em produção/teste. Nunca logar secrets (tokens, app secret, keys).
 * Passadas ao Fastify (`logger`) e usadas na instância standalone do worker.
 */
export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
};

/** Logger raiz standalone (server bootstrap e worker). */
export const logger: Logger = pino(loggerOptions);

/** Cria um child logger com contexto fixo (ex.: { module: "worker" }). */
export function createLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
