import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import {
  WhatsAppOutboundService,
  createWhatsAppOutboundService,
} from "../../../services/tenant/whatsapp/WhatsAppOutboundService.js";

export interface WhatsAppOutboundControllerOptions extends FastifyPluginOptions {
  outboundService?: WhatsAppOutboundService;
}

const sendMessageBodySchema = z.object({
  text: z.string().trim().min(1, "Mensagem não pode estar vazia"),
});

/**
 * Envio outbound de mensagens de texto via Meta WhatsApp Cloud API.
 *
 * Identidade do tenant: lida do header `X-Tenant-ID`. Isso é uma simplificação
 * de DEV/DESAFIO — não há autenticação. O isolamento real é garantido no
 * serviço/banco (todas as queries filtram por tenantId e a conversa precisa
 * pertencer ao tenant informado). Em PRODUÇÃO este header deve ser substituído
 * por auth/JWT/sessão, derivando o tenant da identidade autenticada.
 */
export async function whatsAppOutboundController(
  app: FastifyInstance,
  options: WhatsAppOutboundControllerOptions
): Promise<void> {
  const outboundService =
    options.outboundService ?? createWhatsAppOutboundService();

  app.post<{
    Params: { conversationId: string };
    Headers: { "x-tenant-id"?: string };
    Body: z.infer<typeof sendMessageBodySchema>;
  }>(
    "/conversations/:conversationId/messages",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            "x-tenant-id": { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              conversationId: { type: "string" },
              direction: { type: "string", enum: ["outbound"] },
              body: { type: "string" },
              status: { type: "string" },
              externalMessageId: { type: ["string", "null"] },
              createdAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const bodyResult = sendMessageBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: "Validação falhou",
          details: bodyResult.error.issues,
        });
      }

      const tenantId = request.headers["x-tenant-id"];
      if (!tenantId) {
        return reply.status(401).send({
          error: "X-Tenant-ID header obrigatório",
        });
      }

      const result = await outboundService.sendMessage({
        tenantId,
        conversationId: request.params.conversationId,
        text: bodyResult.data.text,
      });

      return reply.status(201).send(result);
    }
  );
}