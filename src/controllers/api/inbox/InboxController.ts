import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { InboxService } from "../../../services/api/inbox/index.js";

interface ConversationParams {
  conversationId: string;
}

interface SuggestReplyBody {
  conversationId: string;
}

export interface InboxControllerOptions extends FastifyPluginOptions {
  inboxService?: Pick<
    InboxService,
    "getMe" | "listConversations" | "listMessages" | "suggestReply"
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

  app.get<{ Params: ConversationParams }>(
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
      },
    },
    async (request) => {
      return inboxService.listMessages(request.params.conversationId);
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
}
