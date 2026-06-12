import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  metaWebhookHeadersSchema,
  metaWebhookVerificationQuerySchema,
} from "../../../schemas/tenant/whatsapp/WhatsAppWebhookSchemas.js";
import type {
  MetaWebhookHeaders,
  MetaWebhookVerificationQuery,
} from "../../../types/tenant/whatsapp/WhatsAppWebhookTypes.js";
import { WhatsAppWebhookService } from "../../../services/tenant/whatsapp/WhatsAppWebhookService.js";

export interface WhatsAppWebhookControllerOptions extends FastifyPluginOptions {
  webhookService?: WhatsAppWebhookService;
}

export async function whatsAppWebhookController(
  app: FastifyInstance,
  options: WhatsAppWebhookControllerOptions
): Promise<void> {
  const webhookService = options.webhookService ?? new WhatsAppWebhookService();

  app.get<{ Querystring: MetaWebhookVerificationQuery }>(
    "/webhook",
    {
      schema: {
        querystring: metaWebhookVerificationQuerySchema,
      },
    },
    async (request, reply) => {
      const challenge = webhookService.verifySubscription(request.query);
      reply.type("text/plain").send(challenge);
    }
  );

  app.post<{ Headers: MetaWebhookHeaders }>(
    "/webhook",
    {
      schema: {
        headers: metaWebhookHeadersSchema,
      },
    },
    async (request) => {
      return webhookService.receiveWebhook({
        rawBody: request.rawBody,
        headers: request.headers,
        payload: request.body,
      });
    }
  );
}
