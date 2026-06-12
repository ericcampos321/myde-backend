import type { FastifyInstance } from "fastify";
import {
  metaWebhookHeadersSchema,
  metaWebhookVerificationQuerySchema,
} from "./WhatsAppWebhookSchemas.js";
import type {
  MetaWebhookHeaders,
  MetaWebhookVerificationQuery,
} from "./WhatsAppWebhookTypes.js";
import { WhatsAppWebhookService } from "./WhatsAppWebhookService.js";

export async function whatsAppWebhookController(
  app: FastifyInstance
): Promise<void> {
  const webhookService = new WhatsAppWebhookService();

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
      });
    }
  );
}
