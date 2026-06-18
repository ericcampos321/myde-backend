import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { InboxService } from "../../../services/api/inbox/index.js";

interface ConversationParams {
  conversationId: string;
}

interface SuggestReplyBody {
  conversationId: string;
}

interface ContactsQuerystring {
  q?: string;
}

interface MessagesQuerystring {
  limit?: number;
  before?: string;
}

interface MessagesSearchQuerystring {
  q?: string;
  date?: string;
  limit?: number;
  cursor?: string;
}

interface RecentSearchBody {
  targetType: "conversation" | "contact";
  targetId: string;
}

interface AiUsageQuerystring {
  from?: string;
  to?: string;
  conversationId?: string;
  limit?: number;
  cursor?: string;
  model?: string;
  source?: string;
  provider?: string;
  riskLevel?: string;
  blocked?: boolean | string;
  stage?: string;
}

export interface InboxControllerOptions extends FastifyPluginOptions {
  inboxService?: Pick<
    InboxService,
    | "getMe"
    | "listConversations"
    | "listMessagesPage"
    | "searchMessages"
    | "listContacts"
    | "suggestReply"
    | "getAiUsage"
    | "markConversationAsRead"
    | "listRecentSearches"
    | "saveRecentSearch"
    | "clearRecentSearches"
  >;
}

export async function inboxController(
  app: FastifyInstance,
  options: InboxControllerOptions
): Promise<void> {
  const inboxService = options.inboxService ?? new InboxService();

  app.get("/me", async () => {
    return inboxService.getMe();
  });

  app.get("/conversations", async () => {
    return inboxService.listConversations();
  });

  app.get("/recent-searches", async () => {
    return inboxService.listRecentSearches();
  });

  app.post<{ Body: RecentSearchBody }>(
    "/recent-searches",
    {
      schema: {
        body: {
          type: "object",
          required: ["targetType", "targetId"],
          additionalProperties: false,
          properties: {
            targetType: { type: "string", enum: ["conversation", "contact"] },
            targetId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      await inboxService.saveRecentSearch(
        request.body.targetType,
        request.body.targetId
      );
      reply.status(204);
      return null;
    }
  );

  app.delete("/recent-searches", async (_request, reply) => {
    await inboxService.clearRecentSearches();
    reply.status(204);
    return null;
  });

  app.get<{ Querystring: ContactsQuerystring }>(
    "/contacts",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      return inboxService.listContacts(request.query.q);
    }
  );

  app.get<{ Params: ConversationParams; Querystring: MessagesQuerystring }>(
    "/conversations/:conversationId/messages",
    {
      schema: {
        params: {
          type: "object",
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", minLength: 1 },
          },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50 },
            before: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      return inboxService.listMessagesPage(request.params.conversationId, {
        limit: request.query.limit,
        before: request.query.before,
      });
    }
  );

  app.get<{
    Params: ConversationParams;
    Querystring: MessagesSearchQuerystring;
  }>(
    "/conversations/:conversationId/messages/search",
    {
      schema: {
        params: {
          type: "object",
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", minLength: 1 },
          },
        },
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            limit: { type: "integer", minimum: 1, maximum: 50 },
            cursor: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      return inboxService.searchMessages(request.params.conversationId, {
        q: request.query.q,
        date: request.query.date,
        limit: request.query.limit,
        cursor: request.query.cursor,
      });
    }
  );

  app.post<{ Params: ConversationParams }>(
    "/conversations/:conversationId/read",
    {
      schema: {
        params: {
          type: "object",
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      await inboxService.markConversationAsRead(request.params.conversationId);
      reply.status(204);
      return null;
    }
  );

  app.post<{ Body: SuggestReplyBody }>(
    "/ai/suggest",
    {
      schema: {
        body: {
          type: "object",
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      return inboxService.suggestReply(request.body.conversationId);
    }
  );

  app.get<{ Querystring: AiUsageQuerystring }>(
    "/ai/usage",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            conversationId: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", minLength: 1 },
            model: { type: "string", minLength: 1 },
            source: { type: "string", enum: ["openai", "stub"] },
            provider: { type: "string", minLength: 1 },
            riskLevel: { type: "string", enum: ["low", "medium", "high"] },
            blocked: { anyOf: [{ type: "boolean" }, { type: "string" }] },
            stage: {
              type: "string",
              enum: ["input", "output", "recurring", "auto_reply"],
            },
          },
        },
      },
    },
    async (request) => {
      return inboxService.getAiUsage({
        from: request.query.from,
        to: request.query.to,
        conversationId: request.query.conversationId,
        limit: request.query.limit,
        cursor: request.query.cursor,
        model: request.query.model,
        source: request.query.source,
        provider: request.query.provider,
        riskLevel: request.query.riskLevel,
        blocked: request.query.blocked,
        stage: request.query.stage,
      });
    }
  );
}
