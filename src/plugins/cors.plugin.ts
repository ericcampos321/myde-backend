import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/** CORS aberto — útil para inspeção local. Restrinja por origem em produção. */
export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCors, { origin: true });
}
