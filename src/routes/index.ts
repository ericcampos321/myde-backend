import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./api/health.routes.js";
import { inboxRoutes, type InboxRoutesOptions } from "./api/inbox.routes.js";
import {
  whatsAppRoutes,
  type WhatsAppRoutesOptions,
} from "./tenant/whatsapp.routes.js";

export type RegisterRoutesOptions = WhatsAppRoutesOptions & InboxRoutesOptions;

/** Ponto único de registro de rotas, no padrão Rufus. */
export async function registerRoutes(
  app: FastifyInstance,
  options: RegisterRoutesOptions = {}
): Promise<void> {
  await app.register(healthRoutes);
  await app.register(inboxRoutes, options);
  await app.register(whatsAppRoutes, options);
}
