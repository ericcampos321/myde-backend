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
import type {
  MetaWebhookAckResponse,
  MetaWebhookHeaders,
  MetaWebhookVerificationQuery,
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
    }>
  ): Promise<MetaWebhookAckResponse> {
    this.signatureService.validateSignature(
      params.rawBody,
      params.headers["x-hub-signature-256"]
    );

    const mapped = this.payloadMapper.map(params.payload);
    if (mapped.kind === "ignored") {
      this.log.warn({ reason: mapped.reason }, "webhook event ignored");
      return WebhookDeliveryPolicy.ignoredUnsupportedEvent();
    }

    const inbound = mapped.message;
    const resolution = await this.tenantResolutionPolicy.resolveByPhoneNumberId(
      inbound.phoneNumberId
    );
    if (resolution.status !== "found") {
      // A Meta recebe 200 para evitar retries infinitos de um tenant não configurado.
      this.log.warn(
        {
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
      return WebhookDeliveryPolicy.duplicated();
    }

    const contact = await this.contactService.upsertByPhone({
      tenantId: tenant.id,
      phone: inbound.contactPhone,
      name: inbound.contactName,
    });
    if (!contact) {
      this.log.error(
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
      this.log.error(
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

    try {
      await this.messageProcessingQueue.enqueueInboundMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        messageId: message.id,
        externalMessageId: inbound.externalMessageId,
        phoneNumberId: inbound.phoneNumberId,
        contactPhone: inbound.contactPhone,
        displayPhoneNumber: inbound.displayPhoneNumber,
      });
    } catch (error) {
      this.log.error(
        {
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

    return WebhookDeliveryPolicy.persisted();
  }
}
