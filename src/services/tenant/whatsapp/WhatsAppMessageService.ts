import type { Logger } from "pino";
import { createLogger } from "../../../shared/logger/logger.js";
import { WhatsAppMessageRepository } from "../../../repositories/tenant/whatsapp/WhatsAppMessageRepository.js";
import type { WhatsAppMessageRow } from "../../../db/schema/index.js";
import type {
  CreateInboundMessageInput,
  CreateOutboundMessageInput,
} from "../../../types/tenant/whatsapp/WhatsAppMessageTypes.js";

export interface WhatsAppMessageServiceDependencies {
  messageRepository?: WhatsAppMessageRepository;
  log?: Logger;
}

export class WhatsAppMessageService {
  private readonly messageRepository: WhatsAppMessageRepository;
  private readonly log: Logger;

  constructor(dependencies: WhatsAppMessageServiceDependencies = {}) {
    this.messageRepository =
      dependencies.messageRepository ?? new WhatsAppMessageRepository();
    this.log = dependencies.log ?? createLogger({ module: "whatsapp-message" });
  }

  async findById(tenantId: string, id: string): Promise<WhatsAppMessageRow | null> {
    return this.messageRepository.findById(tenantId, id);
  }

  async findByExternalMessageId(
    tenantId: string,
    externalMessageId: string
  ): Promise<WhatsAppMessageRow | null> {
    return this.messageRepository.findByExternalMessageId(
      tenantId,
      externalMessageId
    );
  }

  async createInbound(input: CreateInboundMessageInput): Promise<WhatsAppMessageRow | undefined> {
    const message = await this.messageRepository.createInbound(input);
    if (message) {
      this.log.debug(
        { messageId: message.id, externalMessageId: input.externalMessageId },
        "inbound message created"
      );
    } else {
      this.log.debug(
        { externalMessageId: input.externalMessageId },
        "inbound message already exists (idempotent)"
      );
    }
    return message;
  }

  async createOutbound(input: CreateOutboundMessageInput): Promise<WhatsAppMessageRow | undefined> {
    const message = await this.messageRepository.createOutbound(input);
    if (message) {
      this.log.debug(
        { messageId: message.id, conversationId: input.conversationId },
        "outbound message created"
      );
    }
    return message;
  }

  async findByConversationId(
    tenantId: string,
    conversationId: string
  ): Promise<WhatsAppMessageRow[]> {
    return this.messageRepository.findByConversationId(tenantId, conversationId);
  }

  async findOutboundByReplyToMessageId(
    tenantId: string,
    replyToMessageId: string
  ): Promise<WhatsAppMessageRow | null> {
    return this.messageRepository.findOutboundByReplyToMessageId(
      tenantId,
      replyToMessageId
    );
  }

  /** Atualiza o status de uma outbound pelo wamid (externalMessageId). */
  async updateStatusByExternalMessageId(
    tenantId: string,
    externalMessageId: string,
    status: string,
    failure?: { code: number | null; reason: string | null }
  ): Promise<WhatsAppMessageRow | null> {
    return this.messageRepository.updateStatusByExternalMessageId(
      tenantId,
      externalMessageId,
      status,
      failure
    );
  }
}