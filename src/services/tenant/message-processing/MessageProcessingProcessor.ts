import type { Logger } from "pino";
import { autoReplyEnabled as envAutoReplyEnabled } from "../../../config/env.js";
import { createLogger } from "../../../shared/logger/logger.js";
import {
  AiResponseService,
  createAiResponseService,
} from "../ai/index.js";
import { AiSafetyGuardService } from "../ai/guardrails/AiSafetyGuardService.js";
import { GUARDRAIL_BLOCKED_RESPONSE } from "../ai/guardrails/AiGuardrailResponses.js";
import { AiInteractionLogService } from "../ai/interactions/AiInteractionLogService.js";
import type { AiResponseResult } from "../../../types/tenant/ai/AiTypes.js";
import type { AiSafetyDecision } from "../../../types/tenant/ai/AiGuardrailTypes.js";
import type { WhatsAppConversationRow } from "../../../db/schema/index.js";
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

/**
 * Janela máxima de mensagens recentes carregadas por job para o contexto do
 * auto-reply (achado A-02). Antes o worker carregava a conversa INTEIRA duas vezes
 * por job — risco de escala em conversas longas. Esta janela:
 * - cobre com folga os sinais da AutoReplyPolicy (resposta manual/auto em/após o
 *   inbound atual, que são sempre as mensagens MAIS recentes);
 * - supera o historyLimit da IA (AiResponseService corta para as últimas 10), então
 *   o prompt recebe exatamente o mesmo histórico efetivo de antes.
 * Constante interna (sem env novo), alinhada ao padrão do projeto.
 */
const AUTO_REPLY_CONTEXT_MESSAGE_LIMIT = 50;
const DEFAULT_RECENT_HIGH_RISK_WINDOW_MINUTES = 10;

/** Contrato mínimo do outbound usado pelo worker (facilita injeção em teste). */
export interface OutboundReplySender {
  sendMessage(input: SendMessageInput): Promise<SendMessageOutput>;
}

export interface MessageProcessingProcessorDependencies {
  messageRepository?: Pick<
    WhatsAppMessageRepository,
    "findById" | "findRecentByConversationId"
  >;
  conversationRepository?: Pick<WhatsAppConversationRepository, "findById">;
  aiResponseService?: Pick<AiResponseService, "generateResponse">;
  /** Registra uso seguro da IA (controle de custo). Default: serviço real. */
  interactionLogService?: Pick<AiInteractionLogService, "record"> &
    Partial<Pick<AiInteractionLogService, "countRecentHighRisk">>;
  safetyGuard?: Pick<AiSafetyGuardService, "analyzeInput">;
  log?: Logger;
  /** Liga o envio automático da resposta. Default: flag de ambiente. */
  autoReplyEnabled?: boolean;
  /** Serviço de envio outbound (injetado p/ teste; criado sob demanda no factory). */
  outboundService?: OutboundReplySender;
}

interface ResolvedProcessorDependencies {
  messageRepository: Pick<
    WhatsAppMessageRepository,
    "findById" | "findRecentByConversationId"
  >;
  conversationRepository: Pick<WhatsAppConversationRepository, "findById">;
  aiResponseService: Pick<AiResponseService, "generateResponse">;
  interactionLogService: Pick<
    AiInteractionLogService,
    "record" | "countRecentHighRisk"
  >;
  safetyGuard: Pick<AiSafetyGuardService, "analyzeInput">;
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

    // A-02: contexto BOUNDED (últimas N), não a conversa inteira. Cobre a policy
    // (sinais sempre recentes) e a IA (que ainda corta para as últimas 10).
    const conversationMessages =
      await this.dependencies.messageRepository.findRecentByConversationId(
        payload.tenantId,
        payload.conversationId,
        AUTO_REPLY_CONTEXT_MESSAGE_LIMIT
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

    const recentHighRiskCount =
      await this.dependencies.interactionLogService.countRecentHighRisk({
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        since: new Date(
          Date.now() - DEFAULT_RECENT_HIGH_RISK_WINDOW_MINUTES * 60_000
        ),
      });
    const inputDecision = this.dependencies.safetyGuard.analyzeInput({
      text: message.body,
      recentHighRiskCount,
    });

    if (inputDecision.action === "block") {
      await this.recordAutoReplyGuardrailBlock({
        payload,
        conversation,
        inputCharCount: message.body.length,
        decision: inputDecision,
      });

      if (autoReplyOn) {
        await this.sendGuardrailBlockedReply(payload);
      }

      return {
        processed: true,
        messageId: message.id,
        conversationId: conversation.id,
        aiResponseText: GUARDRAIL_BLOCKED_RESPONSE,
      };
    }

    const aiStartedAt = Date.now();
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
    const aiDurationMs = Date.now() - aiStartedAt;

    // A IA foi realmente chamada (independe do auto-reply ser enviado): registra
    // o uso seguro para o painel de custo. Nunca quebra o fluxo automático.
    await this.recordAutoReplyUsage({
      payload,
      conversation,
      inputCharCount: message.body.length,
      aiResponse,
      durationMs: aiDurationMs,
    });

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
        await this.dependencies.messageRepository.findRecentByConversationId(
          payload.tenantId,
          payload.conversationId,
          AUTO_REPLY_CONTEXT_MESSAGE_LIMIT
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

  private async recordAutoReplyGuardrailBlock(args: {
    payload: MessageProcessingJobPayload;
    conversation: Pick<WhatsAppConversationRow, "id" | "contactId">;
    inputCharCount: number;
    decision: AiSafetyDecision;
  }): Promise<void> {
    const { payload, conversation, inputCharCount, decision } = args;
    try {
      await this.dependencies.interactionLogService.record({
        tenantId: payload.tenantId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        operatorId: null,
        stage: "auto_reply",
        action: "block",
        riskLevel: decision.riskLevel,
        riskReasons: decision.riskReasons,
        matchedRules: decision.matchedRules,
        blocked: true,
        source: null,
        provider: null,
        promptVersion: null,
        inputCharCount,
        outputCharCount: GUARDRAIL_BLOCKED_RESPONSE.length,
        model: null,
        promptTokens: null,
        cachedPromptTokens: null,
        completionTokens: null,
        totalTokens: null,
        durationMs: null,
        contextItemsCount: null,
        contextChars: null,
      });
    } catch (error) {
      this.dependencies.log.warn(
        {
          tenantId: payload.tenantId,
          conversationId: conversation.id,
          messageId: payload.messageId,
          error: error instanceof Error ? error.message : "unknown",
        },
        "[auto-reply] falha ao registrar bloqueio de guardrail (ignorado)"
      );
    }
  }

  /**
   * Registra o uso seguro da IA do auto-reply em `ai_interaction_logs`
   * (stage `auto_reply`). Persiste apenas metadados/contagens — NUNCA prompt,
   * mensagem, resposta crua, token ou segredo. Falha de log nunca derruba o
   * fluxo: erros são apenas logados e engolidos (resposta automática segue).
   */
  private async recordAutoReplyUsage(args: {
    payload: MessageProcessingJobPayload;
    conversation: Pick<WhatsAppConversationRow, "id" | "contactId">;
    inputCharCount: number;
    aiResponse: AiResponseResult;
    durationMs: number;
  }): Promise<void> {
    const { payload, conversation, inputCharCount, aiResponse, durationMs } =
      args;
    try {
      await this.dependencies.interactionLogService.record({
        tenantId: payload.tenantId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        operatorId: null,
        stage: "auto_reply",
        // Sem guardrail neste caminho: a geração é registrada como permitida.
        action: "allow",
        riskLevel: "low",
        riskReasons: [],
        matchedRules: [],
        blocked: false,
        source: aiResponse.source,
        provider: aiResponse.source,
        promptVersion: null,
        inputCharCount,
        outputCharCount: aiResponse.text.length,
        model: aiResponse.model ?? null,
        promptTokens: aiResponse.usage?.promptTokens ?? null,
        ...(aiResponse.usage?.cachedPromptTokens != null
          ? { cachedPromptTokens: aiResponse.usage.cachedPromptTokens }
          : {}),
        completionTokens: aiResponse.usage?.completionTokens ?? null,
        totalTokens: aiResponse.usage?.totalTokens ?? null,
        durationMs,
        contextItemsCount: aiResponse.contextItemsCount ?? null,
        contextChars: aiResponse.contextChars ?? null,
      });
    } catch (error) {
      this.dependencies.log.warn(
        {
          tenantId: payload.tenantId,
          conversationId: conversation.id,
          messageId: payload.messageId,
          error: error instanceof Error ? error.message : "unknown",
        },
        "[auto-reply] falha ao registrar uso da IA (ignorado)"
      );
    }
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

  private async sendGuardrailBlockedReply(
    payload: MessageProcessingJobPayload
  ): Promise<void> {
    try {
      await this.dependencies.outboundService!.sendMessage({
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        text: GUARDRAIL_BLOCKED_RESPONSE,
        replyToMessageId: payload.messageId,
      });
      this.dependencies.log.info(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
        },
        "[auto-reply] resposta de guardrail enviada ao cliente"
      );
    } catch (error) {
      this.dependencies.log.warn(
        {
          tenantId: payload.tenantId,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          code: (error as { code?: string })?.code,
          error: error instanceof Error ? error.message : "unknown",
        },
        "[auto-reply] falha ao enviar resposta de guardrail (sem retry)"
      );
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
    interactionLogService: resolveInteractionLogService(
      dependencies.interactionLogService
    ),
    safetyGuard: dependencies.safetyGuard ?? new AiSafetyGuardService(),
    log:
      dependencies.log ??
      createLogger({ module: "message-processing-processor" }),
    autoReplyEnabled,
    outboundService,
  });
}

function resolveInteractionLogService(
  service:
    | (Pick<AiInteractionLogService, "record"> &
        Partial<Pick<AiInteractionLogService, "countRecentHighRisk">>)
    | undefined
): Pick<AiInteractionLogService, "record" | "countRecentHighRisk"> {
  if (!service) {
    return new AiInteractionLogService();
  }

  return {
    record: service.record.bind(service),
    countRecentHighRisk:
      service.countRecentHighRisk?.bind(service) ?? (async () => 0),
  };
}
