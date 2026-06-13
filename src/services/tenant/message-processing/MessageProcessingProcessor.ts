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

    // Human takeover: se o auto-reply está ligado e o operador já respondeu
    // MANUALMENTE esta conversa depois do inbound, não geramos IA nem enviamos.
    // Checa antes da IA para economizar a chamada à OpenAI. (Quando o auto-reply
    // está desligado, seguimos gerando a sugestão para o operador no composer.)
    if (
      this.dependencies.autoReplyEnabled &&
      this.dependencies.outboundService &&
      message.direction === "inbound" &&
      hasManualReplyAfter(conversationMessages, message)
    ) {
      this.dependencies.log.info(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
        },
        "[auto-reply] conversa já respondida manualmente — ignorando"
      );
      return {
        processed: false,
        skipped: true,
        reason: "manually_answered",
        messageId: message.id,
        conversationId: conversation.id,
      };
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

    const manuallyAnswered = await this.maybeAutoReply(
      payload,
      message,
      aiResponse.text
    );
    if (manuallyAnswered) {
      // Segunda checagem (pós-IA) pegou uma resposta manual: não enviamos.
      return {
        processed: false,
        skipped: true,
        reason: "manually_answered",
        messageId: message.id,
        conversationId: conversation.id,
      };
    }

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
   * - anti-loop: não responde ao próprio número da empresa;
   * - texto de IA vazio/branco → não envia;
   * - **human takeover (double-check)**: além da checagem antes da IA, refaz uma
   *   busca FRESH das mensagens imediatamente antes do envio. Assim, se o operador
   *   responder manualmente DURANTE a geração da IA, o bot ainda não envia;
   * - idempotência (replyToMessageId) garante 1 resposta por inbound, mesmo em retry;
   * - falha da Meta é logada de forma segura e re-lançada para o job falhar/retry.
   *
   * Retorna `true` quando a 2ª checagem detectou resposta manual (job deve concluir
   * como `skipped: manually_answered`); `false` nos demais casos.
   */
  private async maybeAutoReply(
    payload: MessageProcessingJobPayload,
    inbound: TakeoverMessage,
    aiText: string
  ): Promise<boolean> {
    if (!this.dependencies.autoReplyEnabled || !this.dependencies.outboundService) {
      return false;
    }

    if (inbound.direction !== "inbound") {
      // Defensivo: a fila só recebe inbound, mas nunca responder a uma outbound.
      return false;
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
      return false;
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
      return false;
    }

    // Human takeover (2ª checagem): busca FRESH as mensagens imediatamente antes
    // do envio. Fecha a janela de corrida em que o operador responde manualmente
    // DURANTE a geração da IA (a 1ª checagem, pré-IA, não enxergaria essa resposta).
    const freshMessages =
      await this.dependencies.messageRepository.findByConversationId(
        payload.tenantId,
        payload.conversationId
      );
    if (hasManualReplyAfter(freshMessages, inbound)) {
      this.dependencies.log.info(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
        },
        "[auto-reply] conversa respondida manualmente durante geração IA — ignorando"
      );
      return true;
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

    return false;
  }
}

/** Mensagem mínima necessária para a checagem de human takeover. */
interface TakeoverMessage {
  id: string;
  direction: string;
  replyToMessageId: string | null;
  createdAt: Date;
}

/**
 * Indica se já existe uma resposta MANUAL do operador na conversa, criada em ou
 * depois do inbound. Manual = outbound SEM `replyToMessageId` (os auto-replies
 * sempre têm `replyToMessageId`, então não contam — preserva a idempotência).
 * As mensagens já vêm filtradas por tenant+conversa pelo repositório. Defensivo:
 * sem `createdAt` confiável, não bloqueia (evita falso-positivo).
 */
function hasManualReplyAfter(
  messages: ReadonlyArray<TakeoverMessage>,
  inbound: TakeoverMessage
): boolean {
  if (!(inbound.createdAt instanceof Date)) {
    return false;
  }
  const inboundTime = inbound.createdAt.getTime();

  return messages.some((m) => {
    if (m.direction !== "outbound") return false;
    if (m.replyToMessageId != null) return false; // auto-reply, não manual
    if (m.id === inbound.id) return false;
    if (!(m.createdAt instanceof Date)) return false;
    return m.createdAt.getTime() >= inboundTime;
  });
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
