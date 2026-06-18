import type { FastifyInstance } from "fastify";
import { healthController } from "../../controllers/api/health/index.js";

/** Registra as rotas técnicas da API (liveness). */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthController);
}
