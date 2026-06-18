import type { FastifyInstance } from "fastify";
import {
  whatsAppWebhookController,
  whatsAppOutboundController,
} from "../../controllers/tenant/whatsapp/index.js";
import type {
  WhatsAppWebhookService,
  WhatsAppOutboundService,
} from "../../services/tenant/whatsapp/index.js";

export interface WhatsAppRoutesOptions {
  /** Injeção para testes; em produção o controller cria o service padrão. */
  webhookService?: WhatsAppWebhookService;
  outboundService?: WhatsAppOutboundService;
}

/** Registra as rotas do canal WhatsApp (webhook da Meta e envio outbound). */
export async function whatsAppRoutes(
  app: FastifyInstance,
  options: WhatsAppRoutesOptions
): Promise<void> {
  await app.register(whatsAppWebhookController, {
    webhookService: options.webhookService,
  });
  await app.register(whatsAppOutboundController, {
    outboundService: options.outboundService,
  });
}
