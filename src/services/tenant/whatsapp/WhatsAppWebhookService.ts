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
import type {
  MetaWebhookAckResponse,
  MetaWebhookHeaders,
  MetaWebhookVerificationQuery,
} from "../../../types/tenant/whatsapp/WhatsAppWebhookTypes.js";

export interface WhatsAppWebhookServiceDependencies {
  signatureService?: WhatsAppSignatureService;
  payloadMapper?: WhatsAppPayloadMapper;
  tenantService?: WhatsAppTenantService;
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
      return { received: true, ignored: true, reason: mapped.reason };
    }

    const inbound = mapped.message;
    const tenant = await this.tenantService.resolveByPhoneNumberId(
      inbound.phoneNumberId
    );
    if (!tenant) {
      // A Meta recebe 200 para evitar retries infinitos de um tenant não configurado.
      this.log.warn(
        { phoneNumberId: inbound.phoneNumberId, wabaId: inbound.wabaId },
        "webhook ignored for unknown tenant"
      );
      return { received: true, ignored: true, reason: "unknown_tenant" };
    }

    const existingMessage = await this.messageService.findByExternalMessageId(
      tenant.id,
      inbound.externalMessageId
    );
    if (existingMessage) {
      return { received: true, persisted: false, duplicated: true };
    }

    const contact = await this.contactService.upsertByPhone({
      tenantId: tenant.id,
      phone: inbound.contactPhone,
      name: inbound.contactName,
    });
    if (!contact) {
      this.log.error(
        { phone: inbound.contactPhone, tenantId: tenant.id },
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
      return { received: true, persisted: false, duplicated: true };
    }

    try {
      await this.messageProcessingQueue.enqueueInboundMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        messageId: message.id,
        externalMessageId: inbound.externalMessageId,
        phoneNumberId: inbound.phoneNumberId,
        contactPhone: inbound.contactPhone,
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

    return { received: true, persisted: true, duplicated: false };
  }
}
