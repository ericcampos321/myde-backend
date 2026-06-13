import type { Logger } from "pino";
import { autoReplyEnabled as envAutoReplyEnabled } from "../../../config/env.js";
import { createLogger } from "../../../shared/logger/logger.js";
import {
  AiResponseService,
  createAiResponseService,
} from "../ai/index.js";
import {
  WhatsAppOutboundService,
  type SendMessageInput,
  type SendMessageOutput,
} from "../whatsapp/WhatsAppOutboundService.js";
import { samePhoneNumber } from "../../../shared/utils/phone.js";
import { WhatsAppConversationRepository } from "../../../repositories/tenant/whatsapp/index.js";
import { WhatsAppMessageRepository } from "../../../repositories/tenant/whatsapp/index.js";
import type {
  MessageProcessingJobPayload,
  MessageProcessingResult,
} from "../../../queues/message-processing/MessageProcessingQueueTypes.js";

/** Contrato mínimo do outbound usado pelo worker (facilita injeção em teste). */
export interface OutboundReplySender {
  sendMessage(input: SendMessageInput): Promise<SendMessageOutput>;
}

export interface MessageProcessingProcessorDependencies {
  messageRepository?: Pick<
    WhatsAppMessageRepository,
    "findById" | "findByConversationId"
  >;
  conversationRepository?: Pick<WhatsAppConversationRepository, "findById">;
  aiResponseService?: Pick<AiResponseService, "generateResponse">;
  log?: Logger;
  /** Liga o envio automático da resposta. Default: flag de ambiente. */
  autoReplyEnabled?: boolean;
  /** Serviço de envio outbound (injetado p/ teste; criado sob demanda no factory). */
  outboundService?: OutboundReplySender;
}

interface ResolvedProcessorDependencies {
  messageRepository: Pick<
    WhatsAppMessageRepository,
    "findById" | "findByConversationId"
  >;
  conversationRepository: Pick<WhatsAppConversationRepository, "findById">;
  aiResponseService: Pick<AiResponseService, "generateResponse">;
  log: Logger;
  autoReplyEnabled: boolean;
  outboundService: OutboundReplySender | null;
}

export class MessageProcessingProcessor {
  constructor(private readonly dependencies: ResolvedProcessorDependencies) {}

  async processMessageJob(
    payload: MessageProcessingJobPayload
  ): Promise<MessageProcessingResult> {
    if (
      !payload.tenantId ||
      !payload.conversationId ||
      !payload.messageId ||
      !payload.externalMessageId ||
      !payload.phoneNumberId ||
      !payload.contactPhone
    ) {
      return {
        processed: false,
        skipped: true,
        reason: "invalid_payload",
        messageId: payload.messageId,
        conversationId: payload.conversationId,
      };
    }

    const message = await this.dependencies.messageRepository.findById(
      payload.tenantId,
      payload.messageId
    );
    if (!message) {
      return {
        processed: false,
        skipped: true,
        reason: "message_not_found",
        messageId: payload.messageId,
        conversationId: payload.conversationId,
      };
    }

    const conversation = await this.dependencies.conversationRepository.findById(
      payload.tenantId,
      payload.conversationId
    );
    if (!conversation) {
      return {
        processed: false,
        skipped: true,
        reason: "conversation_not_found",
        messageId: payload.messageId,
        conversationId: payload.conversationId,
      };
    }

    const conversationMessages =
      await this.dependencies.messageRepository.findByConversationId(
        payload.tenantId,
        payload.conversationId
      );
    const aiResponse = await this.dependencies.aiResponseService.generateResponse(
      {
        currentMessage: message.body,
        conversationHistory: conversationMessages
          .filter((conversationMessage) => conversationMessage.id !== message.id)
          .map((conversationMessage) => ({
            direction: conversationMessage.direction,
            body: conversationMessage.body,
          })),
      }
    );

    this.dependencies.log.info(
      {
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        externalMessageId: payload.externalMessageId,
        aiSource: aiResponse.source,
      },
      "message processing job handled"
    );

    await this.maybeAutoReply(payload, message.direction, aiResponse.text);

    return {
      processed: true,
      messageId: message.id,
      conversationId: conversation.id,
      aiResponseText: aiResponse.text,
      aiSource: aiResponse.source,
    };
  }

  /**
   * Envia a resposta de IA ao cliente quando o auto-reply está ligado. Guardas:
   * - flag desligada → não faz nada (comportamento padrão);
   * - só responde mensagens INBOUND (nunca responde outbound/própria);
   * - texto de IA vazio/branco → não envia;
   * - idempotência (replyToMessageId) garante 1 resposta por inbound, mesmo em retry;
   * - falha da Meta é logada de forma segura e re-lançada para o job falhar/retry.
   */
  private async maybeAutoReply(
    payload: MessageProcessingJobPayload,
    direction: string,
    aiText: string
  ): Promise<void> {
    if (!this.dependencies.autoReplyEnabled || !this.dependencies.outboundService) {
      return;
    }

    if (direction !== "inbound") {
      // Defensivo: a fila só recebe inbound, mas nunca responder a uma outbound.
      return;
    }

    // Anti-loop: não responder se o remetente é o próprio número da empresa.
    // Compara o `from` (contactPhone) com o telefone REAL exibido da empresa
    // (display_phone_number), ambos normalizados. NUNCA usa phoneNumberId, que
    // é ID técnico da Meta — não é telefone. (O tenant não tem coluna de telefone
    // real; se tivesse, entraria nesta mesma lista de números da empresa.)
    if (samePhoneNumber(payload.contactPhone, payload.displayPhoneNumber)) {
      this.dependencies.log.warn(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
        },
        "[auto-reply] remetente é o próprio número da empresa — ignorando"
      );
      return;
    }

    const text = aiText?.trim() ?? "";
    if (!text) {
      this.dependencies.log.warn(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
        },
        "[auto-reply] sugestão de IA vazia — não enviando"
      );
      return;
    }

    try {
      await this.dependencies.outboundService.sendMessage({
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        text,
        // Chave de idempotência: amarra a resposta ao inbound que a originou.
        replyToMessageId: payload.messageId,
      });
      this.dependencies.log.info(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
        },
        "[auto-reply] resposta enviada ao cliente"
      );
    } catch (error) {
      // Não vaza token/segredo: AppError carrega apenas code/message seguros.
      this.dependencies.log.error(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          code: (error as { code?: string })?.code,
          error: error instanceof Error ? error.message : "unknown",
        },
        "[auto-reply] falha ao enviar resposta pela Meta"
      );
      throw error;
    }
  }
}

export function createMessageProcessingProcessor(
  dependencies: MessageProcessingProcessorDependencies = {}
): MessageProcessingProcessor {
  const autoReplyEnabled = dependencies.autoReplyEnabled ?? envAutoReplyEnabled;

  // Só instancia o outbound (que exige credenciais Meta na construção) quando o
  // auto-reply está ligado e nenhum serviço foi injetado. Desligado = sem custo.
  const outboundService: OutboundReplySender | null =
    dependencies.outboundService ??
    (autoReplyEnabled ? new WhatsAppOutboundService() : null);

  return new MessageProcessingProcessor({
    messageRepository:
      dependencies.messageRepository ?? new WhatsAppMessageRepository(),
    conversationRepository:
      dependencies.conversationRepository ?? new WhatsAppConversationRepository(),
    aiResponseService:
      dependencies.aiResponseService ?? createAiResponseService(),
    log:
      dependencies.log ??
      createLogger({ module: "message-processing-processor" }),
    autoReplyEnabled,
    outboundService,
  });
}
