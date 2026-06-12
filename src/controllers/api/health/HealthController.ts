import type { FastifyInstance } from "fastify";

/** GET /health — liveness simples, sem dependência de Postgres/Redis. */
export async function healthController(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return { ok: true, service: "myde-backend" };
  });
}
