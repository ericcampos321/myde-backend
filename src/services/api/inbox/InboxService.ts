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
  AiUsageService,
  AI_USAGE_RISK_LEVELS,
  AI_USAGE_SOURCES,
  AI_USAGE_STAGES,
  clampUsageLimit,
  parseUsageBoolean,
  parseUsageEnum,
  parseUsageTextFilter,
  resolveUsageWindow,
} from "../../tenant/ai/index.js";
import type { AiSuggestionResult } from "../../../types/tenant/ai/AiSuggestionTypes.js";
import type { AiUsageResult } from "../../../types/tenant/ai/AiUsageTypes.js";
import { InboxOperatorIdentityResolver } from "./InboxOperatorIdentityResolver.js";
import {
  clampMessageLimit,
  decodeMessageCursor,
  encodeMessageCursor,
} from "./inboxMessageCursor.js";
import {
  buildBodyPreview,
  clampSearchLimit,
  escapeLikeSearchTerm,
  MESSAGE_SEARCH,
  parseSearchDate,
} from "./inboxMessageSearch.js";

/** Quantidade de mensagens recentes usada como contexto da sugestão de IA. */
const AI_HISTORY_FETCH_LIMIT = 30;

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
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageStatus: "pending" | InboxMessageStatus | null;
  lastMessageAt: string;
  lastInboundMessageId: string | null;
  lastInboundMessageAt: string | null;
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

export interface InboxMessagePageDto {
  items: InboxMessageDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface InboxMessageSearchResultDto {
  messageId: string;
  conversationId: string;
  bodyPreview: string;
  direction: "inbound" | "outbound";
  status: "pending" | InboxMessageStatus;
  createdAt: string;
  matchedText: string | null;
}

export interface InboxMessageSearchPageDto {
  items: InboxMessageSearchResultDto[];
  nextCursor: string | null;
  hasMore: boolean;
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
    "findById" | "findByContactId" | "listByTenant" | "listConversationSummaries"
  >;
  contactRepository?: Pick<
    WhatsAppContactRepository,
    "findById" | "findByIds" | "listByTenant"
  >;
  messageRepository?: Pick<
    WhatsAppMessageRepository,
    | "findPageByConversationId"
    | "findRecentByConversationId"
    | "searchByConversationId"
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
  aiUsageService?: Pick<AiUsageService, "getUsage">;
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
  private readonly aiUsageService: Required<InboxServiceDependencies>["aiUsageService"];

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
    this.aiUsageService =
      dependencies.aiUsageService ?? new AiUsageService();
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
    // A-01: preview + unread por conversa são resolvidos em UMA query no Postgres
    // (DISTINCT ON + agregação), sem carregar todas as mensagens do tenant.
    const summaries = await this.conversationRepository.listConversationSummaries(
      tenant.id,
      operatorId
    );

    return summaries.map((row) => {
      const contactName = row.contactName?.trim() || "Contato sem nome";
      const lastMessage = row.lastMessageBody ?? "Conversa iniciada no WhatsApp";

      return {
        id: row.id,
        contactName,
        contactPhone: row.contactPhone ?? "",
        avatarColor: pickAvatarColor(row.contactId),
        unread: row.unreadCount,
        lastMessage,
        lastMessageDirection: row.lastMessageDirection,
        lastMessageStatus:
          row.lastMessageDirection === "outbound"
            ? normalizeConversationPreviewStatus(row.lastMessageStatus ?? "")
            : null,
        lastMessageAt: (row.lastMessageAt ?? row.createdAt).toISOString(),
        lastInboundMessageId: row.lastInboundMessageId ?? null,
        lastInboundMessageAt: row.lastInboundMessageAt?.toISOString() ?? null,
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

  async listMessagesPage(
    conversationId: string,
    options: { limit?: unknown; before?: string } = {}
  ): Promise<InboxMessagePageDto> {
    const tenant = await this.resolveCurrentTenant();
    await this.assertConversationExists(tenant.id, conversationId);

    const limit = clampMessageLimit(options.limit);
    const before = decodeMessageCursor(options.before);

    const { items, hasMore } = await this.messageRepository.findPageByConversationId(
      tenant.id,
      conversationId,
      { limit, before }
    );

    const messages = items.map((message) => ({
      id: message.id,
      direction:
        message.direction === "inbound" ? ("in" as const) : ("out" as const),
      body: message.body,
      status: normalizeMessageStatus(message.status),
      createdAt: message.createdAt.toISOString(),
    }));

    // items vêm ASC; o mais antigo da página é o primeiro → cursor da próxima página.
    const oldest = items[0];
    const nextCursor = hasMore && oldest ? encodeMessageCursor(oldest) : null;

    return { items: messages, nextCursor, hasMore };
  }

  async searchMessages(
    conversationId: string,
    options: { q?: string; date?: string; limit?: unknown; cursor?: string } = {}
  ): Promise<InboxMessageSearchPageDto> {
    const tenant = await this.resolveCurrentTenant();
    await this.assertConversationExists(tenant.id, conversationId);

    const term = (options.q ?? "").trim().slice(0, MESSAGE_SEARCH.maxTermLength);
    const hasDateInput = options.date !== undefined && options.date !== "";
    const dateRange = parseSearchDate(options.date);

    // Sem termo válido/data ou com data inválida: vazio sem tocar o banco.
    if (
      (term.length < MESSAGE_SEARCH.minTermLength && !dateRange) ||
      (hasDateInput && !dateRange)
    ) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const limit = clampSearchLimit(options.limit);
    const cursor = decodeMessageCursor(options.cursor);
    const bodyIlikePattern =
      term.length >= MESSAGE_SEARCH.minTermLength
        ? `%${escapeLikeSearchTerm(term)}%`
        : undefined;

    const { items, hasMore } = await this.messageRepository.searchByConversationId(
      tenant.id,
      conversationId,
      { bodyIlikePattern, dateRange, limit, cursor }
    );

    const results = items.map((message): InboxMessageSearchResultDto => {
      const { bodyPreview, matchedText } = buildBodyPreview(message.body, term);
      return {
        messageId: message.id,
        conversationId: message.conversationId,
        bodyPreview,
        direction: message.direction,
        status: normalizeConversationPreviewStatus(message.status),
        createdAt: message.createdAt.toISOString(),
        matchedText,
      };
    });

    // items vêm DESC; o mais antigo é o último → cursor da próxima página.
    const oldest = items[items.length - 1];
    const nextCursor = hasMore && oldest ? encodeMessageCursor(oldest) : null;

    return { items: results, nextCursor, hasMore };
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

    // Bounded: usa só as últimas N mensagens como contexto da IA (sem carregar
    // a conversa inteira). A detecção do último inbound + history continua igual.
    const messages = await this.messageRepository.findRecentByConversationId(
      tenant.id,
      conversationId,
      AI_HISTORY_FETCH_LIMIT
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

  /**
   * Painel read-only de uso da IA (tenant-scoped). Resolve o tenant no servidor,
   * clampeia janela/limit e delega a agregação ao AiUsageService. Não retorna
   * prompt, mensagem ou resposta — apenas métricas/metadados seguros.
   */
  async getAiUsage(
    options: {
      from?: string;
      to?: string;
      conversationId?: string;
      limit?: unknown;
      cursor?: string;
      model?: string;
      source?: string;
      provider?: string;
      riskLevel?: string;
      blocked?: unknown;
      stage?: string;
    } = {}
  ): Promise<AiUsageResult> {
    const tenant = await this.resolveCurrentTenant();
    const { from, to } = resolveUsageWindow({
      from: options.from,
      to: options.to,
    });
    const limit = clampUsageLimit(options.limit);

    return this.aiUsageService.getUsage(
      {
        tenantId: tenant.id,
        from,
        to,
        conversationId: parseUsageTextFilter(options.conversationId),
        model: parseUsageTextFilter(options.model),
        source: parseUsageEnum(options.source, AI_USAGE_SOURCES),
        provider: parseUsageTextFilter(options.provider),
        riskLevel: parseUsageEnum(options.riskLevel, AI_USAGE_RISK_LEVELS),
        blocked: parseUsageBoolean(options.blocked),
        stage: parseUsageEnum(options.stage, AI_USAGE_STAGES),
      },
      limit,
      options.cursor ?? null
    );
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

function normalizeConversationPreviewStatus(
  status: string
): "pending" | InboxMessageStatus {
  if (status === "pending") {
    return "pending";
  }

  return normalizeMessageStatus(status);
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
