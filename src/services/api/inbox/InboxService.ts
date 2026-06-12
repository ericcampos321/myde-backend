import { AppError } from "../../../errors/AppError.js";
import { env, hasOpenAi } from "../../../config/env.js";
import {
  WhatsAppContactRepository,
  WhatsAppConversationRepository,
  WhatsAppMessageRepository,
  WhatsAppTenantRepository,
} from "../../../repositories/tenant/whatsapp/index.js";
import { createAiResponseService } from "../../tenant/ai/index.js";

const AVATAR_COLORS = [
  "#2F855A",
  "#2B6CB0",
  "#B83280",
  "#C05621",
  "#805AD5",
  "#0F766E",
] as const;

export interface InboxAgentProfile {
  id: string;
  name: string;
  role: string;
  capabilities: {
    sendMessage: boolean;
    aiSuggestion: boolean;
  };
}

export interface InboxConversationSummary {
  id: string;
  contactName: string;
  contactPhone: string;
  avatarColor: string;
  unread: number;
  lastMessage: string;
  lastMessageAt: string;
}

export interface InboxMessageDto {
  id: string;
  direction: "in" | "out";
  body: string;
  status: "sent" | "delivered" | "read";
  createdAt: string;
}

export interface InboxSuggestionDto {
  suggestion: string;
  source: "openai" | "stub";
}

export interface InboxServiceDependencies {
  tenantRepository?: Pick<WhatsAppTenantRepository, "findByPhoneNumberId">;
  conversationRepository?: Pick<
    WhatsAppConversationRepository,
    "findById" | "listByTenant"
  >;
  contactRepository?: Pick<WhatsAppContactRepository, "findByIds">;
  messageRepository?: Pick<
    WhatsAppMessageRepository,
    "findByConversationId" | "findByConversationIds"
  >;
}

export class InboxService {
  private readonly tenantRepository: Required<InboxServiceDependencies>["tenantRepository"];
  private readonly conversationRepository: Required<InboxServiceDependencies>["conversationRepository"];
  private readonly contactRepository: Required<InboxServiceDependencies>["contactRepository"];
  private readonly messageRepository: Required<InboxServiceDependencies>["messageRepository"];

  constructor(dependencies: InboxServiceDependencies = {}) {
    this.tenantRepository =
      dependencies.tenantRepository ?? new WhatsAppTenantRepository();
    this.conversationRepository =
      dependencies.conversationRepository ?? new WhatsAppConversationRepository();
    this.contactRepository =
      dependencies.contactRepository ?? new WhatsAppContactRepository();
    this.messageRepository =
      dependencies.messageRepository ?? new WhatsAppMessageRepository();
  }

  async getMe(): Promise<InboxAgentProfile> {
    const tenant = await this.resolveCurrentTenant();

    return {
      id: tenant.id,
      name: tenant.name,
      role: "Inbox real",
      capabilities: {
        sendMessage: true,
        aiSuggestion: hasOpenAi,
      },
    };
  }

  async listConversations(): Promise<InboxConversationSummary[]> {
    const tenant = await this.resolveCurrentTenant();
    const conversations = await this.conversationRepository.listByTenant(tenant.id);

    if (conversations.length === 0) {
      return [];
    }

    const contactIds = [...new Set(conversations.map((conversation) => conversation.contactId))];
    const contacts = await this.contactRepository.findByIds(tenant.id, contactIds);
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));

    const messages = await this.messageRepository.findByConversationIds(
      tenant.id,
      conversations.map((conversation) => conversation.id)
    );
    const lastMessageByConversationId = new Map<string, string>();

    for (const message of messages) {
      lastMessageByConversationId.set(message.conversationId, message.body);
    }

    return conversations.map((conversation) => {
      const contact = contactsById.get(conversation.contactId);
      const contactName = contact?.name?.trim() || "Contato sem nome";
      const lastMessage =
        lastMessageByConversationId.get(conversation.id) ??
        "Conversa iniciada no WhatsApp";

      return {
        id: conversation.id,
        contactName,
        contactPhone: contact?.phone ?? "",
        avatarColor: pickAvatarColor(conversation.contactId),
        unread: 0,
        lastMessage,
        lastMessageAt: (conversation.lastMessageAt ?? conversation.createdAt).toISOString(),
      };
    });
  }

  async listMessages(conversationId: string): Promise<InboxMessageDto[]> {
    const tenant = await this.resolveCurrentTenant();
    await this.assertConversationExists(tenant.id, conversationId);

    const messages = await this.messageRepository.findByConversationId(
      tenant.id,
      conversationId
    );

    return messages.map((message) => ({
      id: message.id,
      direction: message.direction === "inbound" ? "in" : "out",
      body: message.body,
      status: normalizeMessageStatus(message.status),
      createdAt: message.createdAt.toISOString(),
    }));
  }

  async suggestReply(conversationId: string): Promise<InboxSuggestionDto> {
    if (!hasOpenAi) {
      throw new AppError({
        code: "AI_SUGGESTION_UNAVAILABLE",
        message:
          "AI suggestion is unavailable because OPENAI_API_KEY is not configured.",
        statusCode: 503,
      });
    }

    const tenant = await this.resolveCurrentTenant();
    await this.assertConversationExists(tenant.id, conversationId);

    const messages = await this.messageRepository.findByConversationId(
      tenant.id,
      conversationId
    );
    const targetIndex = findLastInboundMessageIndex(messages);

    if (targetIndex < 0) {
      throw new AppError({
        code: "INBOUND_MESSAGE_REQUIRED",
        message: "No inbound message is available to generate a suggestion.",
        statusCode: 409,
      });
    }

    const currentMessage = messages[targetIndex];
    if (!currentMessage) {
      throw new AppError({
        code: "INBOUND_MESSAGE_REQUIRED",
        message: "No inbound message is available to generate a suggestion.",
        statusCode: 409,
      });
    }

    const aiResponseService = createAiResponseService();
    const result = await aiResponseService.generateResponse({
      currentMessage: currentMessage.body,
      conversationHistory: messages.slice(0, targetIndex).map((message) => ({
        direction: message.direction,
        body: message.body,
      })),
    });

    return {
      suggestion: result.text,
      source: result.source,
    };
  }

  private async resolveCurrentTenant() {
    if (!env.META_PHONE_NUMBER_ID) {
      throw new AppError({
        code: "TENANT_PHONE_NUMBER_ID_NOT_CONFIGURED",
        message:
          "META_PHONE_NUMBER_ID is required to expose inbox data for the configured tenant.",
        statusCode: 503,
      });
    }

    const tenant = await this.tenantRepository.findByPhoneNumberId(
      env.META_PHONE_NUMBER_ID
    );

    if (!tenant) {
      throw new AppError({
        code: "TENANT_NOT_FOUND",
        message:
          "No tenant was found for META_PHONE_NUMBER_ID. Run the tenant seed before opening the inbox.",
        statusCode: 503,
      });
    }

    return tenant;
  }

  private async assertConversationExists(
    tenantId: string,
    conversationId: string
  ): Promise<void> {
    const conversation = await this.conversationRepository.findById(
      tenantId,
      conversationId
    );

    if (!conversation) {
      throw new AppError({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation not found for the configured tenant.",
        statusCode: 404,
      });
    }
  }
}

function findLastInboundMessageIndex(
  messages: Array<{ direction: "inbound" | "outbound" }>
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.direction === "inbound") {
      return index;
    }
  }

  return -1;
}

function normalizeMessageStatus(
  status: string
): "sent" | "delivered" | "read" {
  if (status === "read") {
    return "read";
  }

  if (status === "delivered") {
    return "delivered";
  }

  return "sent";
}

function pickAvatarColor(seed: string): string {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}
