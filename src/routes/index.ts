import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./api/health.routes.js";
import {
  whatsAppRoutes,
  type WhatsAppRoutesOptions,
} from "./tenant/whatsapp.routes.js";

export type RegisterRoutesOptions = WhatsAppRoutesOptions;

/** Ponto único de registro de rotas, no padrão Rufus. */
export async function registerRoutes(
  app: FastifyInstance,
  options: RegisterRoutesOptions = {}
): Promise<void> {
  await app.register(healthRoutes);
  await app.register(whatsAppRoutes, options);
}
