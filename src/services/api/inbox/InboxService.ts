import { AppError } from "../../../errors/AppError.js";
import { env, hasOpenAi } from "../../../config/env.js";
import {
  ConversationReadStateRepository,
  InboxRecentSearchRepository,
  type InboxRecentSearchTargetType,
  WhatsAppContactRepository,
  WhatsAppConversationRepository,
  WhatsAppMessageRepository,
  WhatsAppTenantRepository,
} from "../../../repositories/tenant/whatsapp/index.js";
import {
  AiSuggestionService,
} from "../../tenant/ai/index.js";
import type { AiSuggestionResult } from "../../../types/tenant/ai/AiSuggestionTypes.js";
import { InboxOperatorIdentityResolver } from "./InboxOperatorIdentityResolver.js";

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

export type InboxMessageStatus =
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export interface InboxMessageDto {
  id: string;
  direction: "in" | "out";
  body: string;
  status: InboxMessageStatus;
  createdAt: string;
}

export type InboxSuggestionDto = AiSuggestionResult;

export interface InboxContactDto {
  id: string;
  name: string;
  phone: string;
  profileName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxRecentSearchDto {
  id: string;
  targetType: InboxRecentSearchTargetType;
  targetId: string;
  conversationId: string | null;
  label: string;
  subtitle: string;
  avatarInitials: string;
  updatedAt: string;
  canOpen: boolean;
}

export interface InboxServiceDependencies {
  tenantRepository?: Pick<WhatsAppTenantRepository, "findByPhoneNumberId">;
  conversationRepository?: Pick<
    WhatsAppConversationRepository,
    "findById" | "findByContactId" | "listByTenant"
  >;
  contactRepository?: Pick<
    WhatsAppContactRepository,
    "findById" | "findByIds" | "listByTenant"
  >;
  messageRepository?: Pick<
    WhatsAppMessageRepository,
    | "findByConversationId"
    | "findByConversationIds"
    | "findLatestByConversationId"
    | "findLatestInboundByConversationId"
  >;
  readStateRepository?: Pick<
    ConversationReadStateRepository,
    "findByConversationId" | "findByConversationIds" | "upsert"
  >;
  operatorIdentityResolver?: Pick<
    InboxOperatorIdentityResolver,
    "getCurrentOperatorId"
  >;
  recentSearchRepository?: Pick<
    InboxRecentSearchRepository,
    "listByOperator" | "saveAndTrim" | "clearByOperator"
  >;
  aiSuggestionService?: Pick<AiSuggestionService, "suggest">;
}

export class InboxService {
  private readonly tenantRepository: Required<InboxServiceDependencies>["tenantRepository"];
  private readonly conversationRepository: Required<InboxServiceDependencies>["conversationRepository"];
  private readonly contactRepository: Required<InboxServiceDependencies>["contactRepository"];
  private readonly messageRepository: Required<InboxServiceDependencies>["messageRepository"];
  private readonly readStateRepository: Required<InboxServiceDependencies>["readStateRepository"];
  private readonly operatorIdentityResolver: Required<InboxServiceDependencies>["operatorIdentityResolver"];
  private readonly recentSearchRepository: Required<InboxServiceDependencies>["recentSearchRepository"];
  private readonly aiSuggestionService: Required<InboxServiceDependencies>["aiSuggestionService"];

  constructor(dependencies: InboxServiceDependencies = {}) {
    this.tenantRepository =
      dependencies.tenantRepository ?? new WhatsAppTenantRepository();
    this.conversationRepository =
      dependencies.conversationRepository ?? new WhatsAppConversationRepository();
    this.contactRepository =
      dependencies.contactRepository ?? new WhatsAppContactRepository();
    this.messageRepository =
      dependencies.messageRepository ?? new WhatsAppMessageRepository();
    this.readStateRepository =
      dependencies.readStateRepository ?? new ConversationReadStateRepository();
    this.operatorIdentityResolver =
      dependencies.operatorIdentityResolver ?? new InboxOperatorIdentityResolver();
    this.recentSearchRepository =
      dependencies.recentSearchRepository ?? new InboxRecentSearchRepository();
    this.aiSuggestionService =
      dependencies.aiSuggestionService ?? new AiSuggestionService({});
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
    const operatorId = this.operatorIdentityResolver.getCurrentOperatorId();
    const conversations = await this.conversationRepository.listByTenant(tenant.id);

    if (conversations.length === 0) {
      return [];
    }

    const contactIds = [...new Set(conversations.map((conversation) => conversation.contactId))];
    const conversationIds = conversations.map((conversation) => conversation.id);
    const [contacts, messages, readStates] = await Promise.all([
      this.contactRepository.findByIds(tenant.id, contactIds),
      this.messageRepository.findByConversationIds(tenant.id, conversationIds),
      this.readStateRepository.findByConversationIds(
        tenant.id,
        operatorId,
        conversationIds
      ),
    ]);
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const lastMessageByConversationId = new Map<string, string>();
    const unreadByConversationId = new Map<string, number>();
    const readStateByConversationId = new Map(
      readStates.map((state) => [state.conversationId, state])
    );

    for (const message of messages) {
      lastMessageByConversationId.set(message.conversationId, message.body);

      if (message.direction !== "inbound") {
        continue;
      }

      const lastReadAt = readStateByConversationId.get(message.conversationId)?.lastReadAt;
      const isUnread = !lastReadAt || message.createdAt > lastReadAt;

      if (isUnread) {
        unreadByConversationId.set(
          message.conversationId,
          (unreadByConversationId.get(message.conversationId) ?? 0) + 1
        );
      }
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
        unread: unreadByConversationId.get(conversation.id) ?? 0,
        lastMessage,
        lastMessageAt: (conversation.lastMessageAt ?? conversation.createdAt).toISOString(),
      };
    });
  }

  async markConversationAsRead(conversationId: string): Promise<void> {
    const tenant = await this.resolveCurrentTenant();
    await this.assertConversationExists(tenant.id, conversationId);

    const operatorId = this.operatorIdentityResolver.getCurrentOperatorId();
    const [currentReadState, latestInboundMessage, latestMessage] = await Promise.all([
      this.readStateRepository.findByConversationId(
        tenant.id,
        operatorId,
        conversationId
      ),
      this.messageRepository.findLatestInboundByConversationId(
        tenant.id,
        conversationId
      ),
      this.messageRepository.findLatestByConversationId(tenant.id, conversationId),
    ]);

    if (!latestInboundMessage) {
      return;
    }

    const alreadyReadByMessageId =
      currentReadState?.lastReadMessageId === latestInboundMessage.id;
    const alreadyReadByTimestamp =
      !!currentReadState?.lastReadAt &&
      currentReadState.lastReadAt >= latestInboundMessage.createdAt;

    if (alreadyReadByMessageId || alreadyReadByTimestamp) {
      return;
    }

    await this.readStateRepository.upsert({
      tenantId: tenant.id,
      conversationId,
      operatorId,
      lastReadAt: new Date(),
      lastReadMessageId: latestMessage?.id ?? latestInboundMessage.id,
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

  async listContacts(searchTerm?: string): Promise<InboxContactDto[]> {
    const tenant = await this.resolveCurrentTenant();
    const contacts = await this.contactRepository.listByTenant(tenant.id, searchTerm);

    return contacts.map((contact) => ({
      id: contact.id,
      name: contact.name?.trim() || "Contato sem nome",
      phone: contact.phone,
      profileName: contact.name?.trim() || null,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    }));
  }

  async listRecentSearches(): Promise<InboxRecentSearchDto[]> {
    const tenant = await this.resolveCurrentTenant();
    const operatorId = this.operatorIdentityResolver.getCurrentOperatorId();
    const recentSearches = await this.recentSearchRepository.listByOperator(
      tenant.id,
      operatorId,
      4
    );

    const items = await Promise.all(
      recentSearches.map(async (recent): Promise<InboxRecentSearchDto | null> => {
        if (recent.targetType === "conversation") {
          const conversation = await this.conversationRepository.findById(
            tenant.id,
            recent.targetId
          );
          if (!conversation) return null;

          const contact = await this.contactRepository.findById(
            tenant.id,
            conversation.contactId
          );
          const label = contact?.name?.trim() || "Contato sem nome";

          return {
            id: recent.id,
            targetType: recent.targetType,
            targetId: recent.targetId,
            conversationId: conversation.id,
            label,
            subtitle: contact?.phone ?? "",
            avatarInitials: getInitials(label),
            updatedAt: recent.updatedAt.toISOString(),
            canOpen: true,
          };
        }

        const contact = await this.contactRepository.findById(tenant.id, recent.targetId);
        if (!contact) return null;

        const conversation = await this.conversationRepository.findByContactId(
          tenant.id,
          contact.id
        );
        const label = contact.name?.trim() || "Contato sem nome";

        return {
          id: recent.id,
          targetType: recent.targetType,
          targetId: recent.targetId,
          conversationId: conversation?.id ?? null,
          label,
          subtitle: contact.phone,
          avatarInitials: getInitials(label),
          updatedAt: recent.updatedAt.toISOString(),
          canOpen: Boolean(conversation),
        };
      })
    );

    return items.filter((item): item is InboxRecentSearchDto => item !== null);
  }

  async saveRecentSearch(
    targetType: InboxRecentSearchTargetType,
    targetId: string
  ): Promise<void> {
    const tenant = await this.resolveCurrentTenant();
    const operatorId = this.operatorIdentityResolver.getCurrentOperatorId();

    const target =
      targetType === "conversation"
        ? await this.conversationRepository.findById(tenant.id, targetId)
        : await this.contactRepository.findById(tenant.id, targetId);

    if (!target) {
      throw new AppError({
        code: "RECENT_SEARCH_TARGET_NOT_FOUND",
        message: "Recent search target not found for the configured tenant.",
        statusCode: 404,
      });
    }

    await this.recentSearchRepository.saveAndTrim(
      {
        tenantId: tenant.id,
        operatorId,
        targetType,
        targetId,
      },
      4
    );
  }

  async clearRecentSearches(): Promise<void> {
    const tenant = await this.resolveCurrentTenant();
    const operatorId = this.operatorIdentityResolver.getCurrentOperatorId();
    await this.recentSearchRepository.clearByOperator(tenant.id, operatorId);
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
    const conversation = await this.getConversationOrThrow(tenant.id, conversationId);

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

    return this.aiSuggestionService.suggest({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      operatorId: this.operatorIdentityResolver.getCurrentOperatorId(),
      userMessage: currentMessage.body,
      history: messages.slice(0, targetIndex).map((message) => ({
        role: message.direction === "inbound" ? "user" : "assistant",
        content: message.body,
      })),
    });
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
    await this.getConversationOrThrow(tenantId, conversationId);
  }

  private async getConversationOrThrow(tenantId: string, conversationId: string) {
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

    return conversation;
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

function normalizeMessageStatus(status: string): InboxMessageStatus {
  if (status === "read") {
    return "read";
  }

  if (status === "delivered") {
    return "delivered";
  }

  // A Meta marca entrega falha via webhook statuses[] → persistimos "failed".
  // Não mascaramos como "sent": a UI deve distinguir.
  if (status === "failed") {
    return "failed";
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

function getInitials(label: string): string {
  return label
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
