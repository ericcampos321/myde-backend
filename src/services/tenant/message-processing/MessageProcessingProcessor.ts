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
import {
  AutoReplyPolicy,
  type AutoReplyDecisionReason,
} from "../../../policies/whatsapp/index.js";
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

    const autoReplyOn =
      this.dependencies.autoReplyEnabled && !!this.dependencies.outboundService;

    // PRÉ-IA: se o auto-reply está ligado e ESTE inbound já não é elegível
    // (takeover / anti-loop / já respondido), pula a IA (economia) e o envio.
    // A decisão é por inbound específico: uma resposta manual ANTERIOR não bloqueia
    // um inbound novo (o cliente que escreve de novo volta a ser elegível).
    if (autoReplyOn) {
      const pre = AutoReplyPolicy.decide({
        autoReplyEnabled: true,
        inbound: message,
        messages: conversationMessages,
        contactPhone: payload.contactPhone,
        companyPhone: payload.displayPhoneNumber,
      });
      if (!pre.shouldReply) {
        return this.skipAutoReply(payload, message.id, conversation.id, pre.reason, "pre-ia");
      }
    }

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

    // PRÉ-ENVIO: re-decide com busca FRESH + o texto da IA. Fecha a janela de
    // corrida (operador responde DURANTE a geração) e checa vacuidade da IA.
    if (autoReplyOn) {
      const freshMessages =
        await this.dependencies.messageRepository.findByConversationId(
          payload.tenantId,
          payload.conversationId
        );
      const decision = AutoReplyPolicy.decide({
        autoReplyEnabled: true,
        inbound: message,
        messages: freshMessages,
        contactPhone: payload.contactPhone,
        companyPhone: payload.displayPhoneNumber,
        aiText: aiResponse.text,
      });
      if (!decision.shouldReply) {
        return this.skipAutoReply(payload, message.id, conversation.id, decision.reason, "pre-envio");
      }
      await this.sendAutoReply(payload, aiResponse.text);
    }

    return {
      processed: true,
      messageId: message.id,
      conversationId: conversation.id,
      aiResponseText: aiResponse.text,
      aiSource: aiResponse.source,
    };
  }

  /** Loga (seguro) e devolve o resultado de job pulado por decisão de auto-reply. */
  private skipAutoReply(
    payload: MessageProcessingJobPayload,
    messageId: string,
    conversationId: string,
    reason: Exclude<AutoReplyDecisionReason, "eligible">,
    phase: "pre-ia" | "pre-envio"
  ): MessageProcessingResult {
    this.dependencies.log.info(
      {
        tenantId: payload.tenantId,
        conversationId,
        messageId,
        reason,
        phase,
      },
      "[auto-reply] não enviado"
    );
    return {
      processed: false,
      skipped: true,
      reason,
      messageId,
      conversationId,
    };
  }

  /** Envia a resposta automática (Meta primeiro + persistência no outbound). */
  private async sendAutoReply(
    payload: MessageProcessingJobPayload,
    text: string
  ): Promise<void> {
    try {
      await this.dependencies.outboundService!.sendMessage({
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
