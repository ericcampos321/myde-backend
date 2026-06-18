import type { FastifyReply, FastifyRequest } from "fastify";
import { isAppError } from "./AppError.js";

interface ErrorBody {
  error: string;
  code: string;
  details?: unknown;
}

/**
 * Error handler central do Fastify. Traduz AppError → resposta tipada e
 * normaliza erros inesperados como 500 sem vazar stack/detalhes internos.
 */
export function httpErrorHandler(
  err: Error,
  req: FastifyRequest,
  reply: FastifyReply
): void {
  if (isAppError(err)) {
    req.log.warn(
      { code: err.code, statusCode: err.statusCode },
      "domain error"
    );
    const body: ErrorBody = { error: err.message, code: err.code };
    if (err.details !== undefined) body.details = err.details;
    reply.status(err.statusCode).send(body);
    return;
  }

  // Erros de validação do Fastify (schema) chegam com statusCode 400.
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  if (statusCode < 500) {
    reply.status(statusCode).send({ error: err.message, code: "BAD_REQUEST" });
    return;
  }

  req.log.error({ err }, "unhandled error");
  reply.status(500).send({ error: "Internal Server Error", code: "INTERNAL" });
}
