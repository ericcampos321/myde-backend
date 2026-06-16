import type { Logger } from "pino";
import { env } from "../../../config/env.js";
import { AppError } from "../../../errors/AppError.js";
import { createLogger } from "../../../shared/logger/logger.js";
import {
  BullMqMessageProcessingQueue,
  type MessageProcessingQueuePort,
} from "../../../queues/message-processing/index.js";
import {
  WhatsAppTenantService,
} from "./WhatsAppTenantService.js";
import {
  WhatsAppContactService,
} from "./WhatsAppContactService.js";
import { WhatsAppConversationRepository } from "../../../repositories/tenant/whatsapp/WhatsAppConversationRepository.js";
import {
  WhatsAppMessageService,
} from "./WhatsAppMessageService.js";
import { WhatsAppPayloadMapper } from "./WhatsAppPayloadMapper.js";
import { WhatsAppSignatureService } from "./WhatsAppSignatureService.js";
import { TenantResolutionPolicy } from "../../../policies/tenant/index.js";
import { WebhookDeliveryPolicy } from "../../../policies/webhook/index.js";
import { maskPhone } from "../../../shared/utils/phone.js";
import { LogEvents } from "../../../shared/logger/events.js";
import type { WhatsAppMessageRow } from "../../../db/schema/index.js";
import type {
  MetaWebhookAckResponse,
  MetaWebhookHeaders,
  MetaWebhookVerificationQuery,
  NormalizedInboundMessage,
  NormalizedMessageStatus,
} from "../../../types/tenant/whatsapp/WhatsAppWebhookTypes.js";

export interface WhatsAppWebhookServiceDependencies {
  signatureService?: WhatsAppSignatureService;
  payloadMapper?: WhatsAppPayloadMapper;
  tenantService?: WhatsAppTenantService;
  tenantResolutionPolicy?: TenantResolutionPolicy;
  contactService?: WhatsAppContactService;
  messageService?: WhatsAppMessageService;
  conversationRepository?: WhatsAppConversationRepository;
  messageProcessingQueue?: MessageProcessingQueuePort;
  log?: Logger;
}

export class WhatsAppWebhookService {
  private readonly signatureService: WhatsAppSignatureService;
  private readonly payloadMapper: WhatsAppPayloadMapper;
  private readonly tenantService: WhatsAppTenantService;
  private readonly tenantResolutionPolicy: TenantResolutionPolicy;
  private readonly contactService: WhatsAppContactService;
  private readonly messageService: WhatsAppMessageService;
  private readonly conversationRepository: WhatsAppConversationRepository;
  private readonly messageProcessingQueue: MessageProcessingQueuePort;
  private readonly log: Logger;

  constructor(dependencies: WhatsAppWebhookServiceDependencies = {}) {
    this.signatureService =
      dependencies.signatureService ?? new WhatsAppSignatureService();
    this.payloadMapper = dependencies.payloadMapper ?? new WhatsAppPayloadMapper();
    this.tenantService =
      dependencies.tenantService ?? new WhatsAppTenantService();
    this.tenantResolutionPolicy =
      dependencies.tenantResolutionPolicy ??
      new TenantResolutionPolicy({ tenantService: this.tenantService });
    this.contactService =
      dependencies.contactService ?? new WhatsAppContactService();
    this.messageService =
      dependencies.messageService ?? new WhatsAppMessageService();
    this.conversationRepository =
      dependencies.conversationRepository ?? new WhatsAppConversationRepository();
    this.messageProcessingQueue =
      dependencies.messageProcessingQueue ?? new BullMqMessageProcessingQueue();
    this.log = dependencies.log ?? createLogger({ module: "whatsapp-webhook" });
  }

  verifySubscription(query: MetaWebhookVerificationQuery): string {
    const mode = query["hub.mode"];
    const verifyToken = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (!env.META_VERIFY_TOKEN) {
      // Sem fallback mock em dev/prod: falha explícita de configuração.
      throw new AppError({
        code: "META_VERIFY_TOKEN_NOT_CONFIGURED",
        message:
          "META_VERIFY_TOKEN não configurado. Defina a credencial real no .env para o handshake do webhook.",
        statusCode: 500,
      });
    }

    if (
      mode !== "subscribe" ||
      verifyToken !== env.META_VERIFY_TOKEN ||
      !challenge
    ) {
      throw new AppError({
        code: "META_WEBHOOK_FORBIDDEN",
        message: "Webhook verification failed",
        statusCode: 403,
      });
    }

    return challenge;
  }

  async receiveWebhook(
    params: Readonly<{
      rawBody: Buffer | undefined;
      headers: MetaWebhookHeaders;
      payload: unknown;
      requestId?: string;
    }>
  ): Promise<MetaWebhookAckResponse> {
    const startedAt = Date.now();
    // Child logger com requestId: todos os logs DESTE webhook carregam o mesmo
    // requestId, permitindo correlacionar a entrega ponta a ponta.
    const log = params.requestId
      ? this.log.child({ requestId: params.requestId })
      : this.log;

    try {
      this.signatureService.validateSignature(
        params.rawBody,
        params.headers["x-hub-signature-256"]
      );
    } catch (error) {
      log.warn(
        {
          event: LogEvents.webhook.signatureInvalid,
          code: (error as { code?: string })?.code,
        },
        "webhook signature rejected"
      );
      throw error;
    }

    const mapped = this.payloadMapper.map(params.payload);
    if (mapped.kind === "status") {
      // Status de entrega de outbound (sent/delivered/read/failed): loga de forma
      // clara e atualiza o status da mensagem (best-effort). Sem worker, sem erro,
      // 200 para a Meta.
      await this.handleStatusEvent(mapped.phoneNumberId, mapped.statuses, log);
      return WebhookDeliveryPolicy.ignoredStatusEvent();
    }
    if (mapped.kind === "ignored") {
      log.warn(
        { event: LogEvents.webhook.ignoredUnsupported, reason: mapped.reason },
        "webhook event ignored"
      );
      return WebhookDeliveryPolicy.ignoredUnsupportedEvent();
    }

    const inbound = mapped.message;
    const resolution = await this.tenantResolutionPolicy.resolveByPhoneNumberId(
      inbound.phoneNumberId
    );
    if (resolution.status !== "found") {
      // A Meta recebe 200 para evitar retries infinitos de um tenant não configurado.
      log.warn(
        {
          event: LogEvents.webhook.ignoredUnknownTenant,
          phoneNumberId: inbound.phoneNumberId,
          wabaId: inbound.wabaId,
          resolution: resolution.status,
        },
        "webhook ignored for unknown tenant"
      );
      return WebhookDeliveryPolicy.ignoredUnknownTenant();
    }
    const tenant = resolution.tenant;

    const existingMessage = await this.messageService.findByExternalMessageId(
      tenant.id,
      inbound.externalMessageId
    );
    if (existingMessage) {
      log.info(
        {
          event: LogEvents.webhook.inboundDuplicated,
          tenantId: tenant.id,
          conversationId: existingMessage.conversationId,
          messageId: existingMessage.id,
          externalMessageId: inbound.externalMessageId,
        },
        "webhook inbound duplicated (idempotent skip)"
      );
      // A-03: a mensagem já existe, mas o job de processamento pode não ter sido
      // criado (falha entre persistência e enqueue numa entrega anterior). Repara
      // de forma idempotente (jobId = externalMessageId): se o job já existe, o
      // BullMQ não duplica; se sumiu, recria. Sem tocar o Postgres, sem OpenAI/Meta.
      await this.ensureInboundProcessingEnqueued(existingMessage, inbound, log);
      return WebhookDeliveryPolicy.duplicated();
    }

    const contact = await this.contactService.upsertByPhone({
      tenantId: tenant.id,
      phone: inbound.contactPhone,
      name: inbound.contactName,
    });
    if (!contact) {
      log.error(
        { phone: maskPhone(inbound.contactPhone), tenantId: tenant.id },
        "failed to upsert contact"
      );
      throw new AppError({
        code: "CONTACT_CREATION_FAILED",
        message: "Failed to create or retrieve contact",
        statusCode: 500,
      });
    }

    const conversation = await this.conversationRepository.upsertOpenByContact({
      tenantId: tenant.id,
      contactId: contact.id,
      lastMessageAt: inbound.timestamp,
    });
    if (!conversation) {
      log.error(
        { contactId: contact.id, tenantId: tenant.id },
        "failed to upsert conversation"
      );
      throw new AppError({
        code: "CONVERSATION_CREATION_FAILED",
        message: "Failed to create or retrieve conversation",
        statusCode: 500,
      });
    }

    const message = await this.messageService.createInbound({
      tenantId: tenant.id,
      conversationId: conversation.id,
      body: inbound.text,
      externalMessageId: inbound.externalMessageId,
      createdAt: inbound.timestamp,
    });

    if (!message) {
      return WebhookDeliveryPolicy.duplicated();
    }

    let jobId: string | undefined;
    try {
      const enqueued = await this.messageProcessingQueue.enqueueInboundMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        messageId: message.id,
        externalMessageId: inbound.externalMessageId,
        phoneNumberId: inbound.phoneNumberId,
        contactPhone: inbound.contactPhone,
        displayPhoneNumber: inbound.displayPhoneNumber,
      });
      jobId = enqueued.jobId;
    } catch (error) {
      log.error(
        {
          event: LogEvents.messageProcessing.failed,
          err: error,
          tenantId: tenant.id,
          conversationId: conversation.id,
          messageId: message.id,
          externalMessageId: inbound.externalMessageId,
        },
        "failed to enqueue inbound message"
      );
      throw error;
    }

    log.info(
      {
        event: LogEvents.webhook.inboundPersisted,
        tenantId: tenant.id,
        conversationId: conversation.id,
        contactId: contact.id,
        messageId: message.id,
        externalMessageId: inbound.externalMessageId,
        phoneNumberId: inbound.phoneNumberId,
        jobId,
        durationMs: Date.now() - startedAt,
      },
      "webhook inbound persisted and enqueued"
    );

    return WebhookDeliveryPolicy.persisted();
  }

  /**
   * Garante (best-effort, idempotente) que existe um job de processamento para uma
   * mensagem inbound JÁ persistida — usado quando o webhook chega duplicado e o
   * enqueue de uma entrega anterior pode ter falhado (achado A-03).
   *
   * - Só re-enfileira mensagens **inbound** com `externalMessageId` (a chave
   *   idempotente = jobId). Duplicado de outbound/status ou sem id é ignorado.
   * - Reusa a fila com `jobId = externalMessageId`: o BullMQ não cria job duplicado
   *   se ele já existe; se foi removido, recria (repara o job ausente).
   * - NÃO chama OpenAI nem Meta e NÃO toca no Postgres. A decisão de responder
   *   (auto-reply/anti-loop/human takeover) permanece 100% no worker.
   * - Erros são logados de forma segura (code/mensagem; sem prompt/token/segredo) e
   *   engolidos — o ACK para a Meta continua 200.
   */
  private async ensureInboundProcessingEnqueued(
    existingMessage: WhatsAppMessageRow,
    inbound: NormalizedInboundMessage,
    log: Logger
  ): Promise<void> {
    if (
      existingMessage.direction !== "inbound" ||
      !existingMessage.externalMessageId
    ) {
      log.info(
        {
          event: LogEvents.webhook.reenqueueSkipped,
          tenantId: existingMessage.tenantId,
          conversationId: existingMessage.conversationId,
          messageId: existingMessage.id,
          externalMessageId: existingMessage.externalMessageId,
          direction: existingMessage.direction,
        },
        "webhook inbound duplicate: re-enqueue skipped (não é inbound processável)"
      );
      return;
    }

    try {
      const enqueued = await this.messageProcessingQueue.enqueueInboundMessage({
        tenantId: existingMessage.tenantId,
        conversationId: existingMessage.conversationId,
        messageId: existingMessage.id,
        externalMessageId: existingMessage.externalMessageId,
        phoneNumberId: inbound.phoneNumberId,
        contactPhone: inbound.contactPhone,
        displayPhoneNumber: inbound.displayPhoneNumber,
      });
      log.info(
        {
          event: LogEvents.webhook.reenqueueAttempted,
          tenantId: existingMessage.tenantId,
          conversationId: existingMessage.conversationId,
          messageId: existingMessage.id,
          externalMessageId: existingMessage.externalMessageId,
          jobId: enqueued.jobId,
        },
        "webhook inbound duplicate: job de processamento garantido (re-enqueue idempotente)"
      );
    } catch (error) {
      log.error(
        {
          event: LogEvents.webhook.reenqueueFailed,
          tenantId: existingMessage.tenantId,
          conversationId: existingMessage.conversationId,
          messageId: existingMessage.id,
          externalMessageId: existingMessage.externalMessageId,
          code: (error as { code?: string })?.code,
          error: error instanceof Error ? error.message : "unknown",
        },
        "webhook inbound duplicate: re-enqueue falhou (ignorado)"
      );
    }
  }

  /**
   * Trata eventos de status de entrega da outbound (sent/delivered/read/failed).
   * Loga de forma clara (deixa explícito quando a Meta retornou `failed`) e
   * atualiza o status da mensagem outbound pelo externalMessageId (best-effort,
   * tenant-scoped). Nunca lança — o ACK para a Meta continua 200.
   */
  private async handleStatusEvent(
    phoneNumberId: string | null,
    statuses: NormalizedMessageStatus[],
    log: Logger = this.log
  ): Promise<void> {
    for (const s of statuses) {
      const level = s.status === "failed" ? "warn" : "info";
      log[level](
        {
          event: LogEvents.webhook.statusReceived,
          externalMessageId: s.messageId,
          status: s.status,
          // Destinatário mascarado (LGPD): permite conferir o final do número.
          recipientId: maskPhone(s.recipientId),
          timestamp: s.timestamp,
          // Motivo EXATO da Meta quando status=failed:
          errorCode: s.errorCode,
          errorTitle: s.errorTitle,
          errorMessage: s.errorMessage,
          errorDetails: s.errorDetails,
        },
        s.status === "failed"
          ? "webhook status event: MENSAGEM NÃO ENTREGUE (failed)"
          : "webhook status event"
      );
    }

    // Atualiza o status no banco, se conseguirmos resolver o tenant.
    const resolution =
      await this.tenantResolutionPolicy.resolveByPhoneNumberId(phoneNumberId);
    if (resolution.status !== "found") {
      return;
    }

    for (const s of statuses) {
      try {
        const failure =
          s.status === "failed"
            ? {
                code: s.errorCode,
                // Motivo legível: details > message > title.
                reason:
                  s.errorDetails ?? s.errorMessage ?? s.errorTitle ?? null,
              }
            : undefined;
        const updated =
          await this.messageService.updateStatusByExternalMessageId(
            resolution.tenant.id,
            s.messageId,
            s.status,
            failure
          );
        if (!updated) {
          log.debug(
            { externalMessageId: s.messageId, status: s.status },
            "status event: outbound não encontrada para atualizar"
          );
        }
      } catch (error) {
        // Best-effort: falha em atualizar status não deve quebrar o ACK.
        log.error(
          {
            err: error,
            externalMessageId: s.messageId,
            status: s.status,
          },
          "status event: falha ao atualizar status da outbound"
        );
      }
    }
  }
}
