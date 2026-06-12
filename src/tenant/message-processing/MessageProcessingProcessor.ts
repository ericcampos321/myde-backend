import type { Logger } from "pino";
import { createLogger } from "../../shared/logger/logger.js";
import { WhatsAppConversationRepository } from "../whatsapp-conversations/index.js";
import { WhatsAppMessageRepository } from "../whatsapp-messages/index.js";
import type {
  MessageProcessingJobPayload,
  MessageProcessingResult,
} from "./MessageProcessingQueueTypes.js";

export interface MessageProcessingProcessorDependencies {
  messageRepository?: Pick<WhatsAppMessageRepository, "findById">;
  conversationRepository?: Pick<WhatsAppConversationRepository, "findById">;
  log?: Logger;
}

export class MessageProcessingProcessor {
  constructor(
    private readonly dependencies: Required<MessageProcessingProcessorDependencies>
  ) {}

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

    this.dependencies.log.info(
      {
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        externalMessageId: payload.externalMessageId,
      },
      "message processing job handled"
    );

    return {
      processed: true,
      messageId: message.id,
      conversationId: conversation.id,
    };
  }
}

export function createMessageProcessingProcessor(
  dependencies: MessageProcessingProcessorDependencies = {}
): MessageProcessingProcessor {
  return new MessageProcessingProcessor({
    messageRepository:
      dependencies.messageRepository ?? new WhatsAppMessageRepository(),
    conversationRepository:
      dependencies.conversationRepository ?? new WhatsAppConversationRepository(),
    log:
      dependencies.log ??
      createLogger({ module: "message-processing-processor" }),
  });
}
