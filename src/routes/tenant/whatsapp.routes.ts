import type { FastifyInstance } from "fastify";
import { whatsAppWebhookController } from "../../controllers/tenant/whatsapp/index.js";
import type { WhatsAppWebhookService } from "../../services/tenant/whatsapp/index.js";

export interface WhatsAppRoutesOptions {
  /** Injeção para testes; em produção o controller cria o service padrão. */
  webhookService?: WhatsAppWebhookService;
}

/** Registra as rotas do canal WhatsApp (webhook da Meta). */
export async function whatsAppRoutes(
  app: FastifyInstance,
  options: WhatsAppRoutesOptions
): Promise<void> {
  await app.register(whatsAppWebhookController, {
    webhookService: options.webhookService,
  });
}
