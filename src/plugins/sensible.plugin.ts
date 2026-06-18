import fastifySensible from "@fastify/sensible";
import type { FastifyInstance } from "fastify";

/** Adiciona utilitários de erro HTTP (app.httpErrors.*) e helpers de resposta. */
export async function registerSensible(app: FastifyInstance): Promise<void> {
  await app.register(fastifySensible);
}
