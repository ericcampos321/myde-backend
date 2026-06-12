import type { FastifyInstance, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Corpo cru da requisição, preservado para validação de assinatura HMAC. */
    rawBody?: Buffer;
  }
}

/**
 * Substitui o parser JSON padrão por um que preserva o Buffer cru em
 * `request.rawBody` antes de parsear. Necessário para validar o
 * X-Hub-Signature-256 da Meta sobre o corpo exatamente como recebido.
 */
export async function registerRawBody(app: FastifyInstance): Promise<void> {
  const parseJsonWithRawBody = (
    req: FastifyRequest,
    body: Buffer,
    done: (err: Error | null, body?: unknown) => void
  ): void => {
    req.rawBody = body;
    if (body.length === 0) {
      done(null, undefined);
      return;
    }

    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  };

  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      parseJsonWithRawBody(req, body as Buffer, done);
    }
  );

  app.addContentTypeParser(
    /^application\/(.+\+)?json(;.*)?$/i,
    { parseAs: "buffer" },
    (req, body, done) => {
      parseJsonWithRawBody(req, body as Buffer, done);
    }
  );
}
