import type { FastifyInstance } from "fastify";

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
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      const buf = body as Buffer;
      req.rawBody = buf;
      if (buf.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(buf.toString("utf8")));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );
}
