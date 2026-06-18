import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../bootstrap/app.js";

let app: FastifyInstance;

const inboxService = {
  getMe: vi.fn().mockResolvedValue({
    id: "tenant-1",
    name: "NeoFibra",
    role: "Inbox real",
    capabilities: {
      sendMessage: false,
      aiSuggestion: true,
    },
  }),
  listConversations: vi.fn().mockResolvedValue([
    {
      id: "conv-1",
      contactName: "Maria",
      contactPhone: "5511999999999",
      avatarColor: "#2F855A",
      unread: 0,
      lastMessage: "Oi, preciso de ajuda",
      lastMessageAt: "2026-06-12T12:00:00.000Z",
    },
  ]),
  listContacts: vi.fn().mockResolvedValue([
    {
      id: "contact-1",
      name: "Maria",
      phone: "5511999999999",
      profileName: "Maria",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T12:00:00.000Z",
    },
  ]),
  listMessagesPage: vi.fn().mockResolvedValue({
    items: [
      {
        id: "msg-1",
        direction: "in",
        body: "Oi, preciso de ajuda",
        status: "sent",
        createdAt: "2026-06-12T12:00:00.000Z",
      },
    ],
    nextCursor: null,
    hasMore: false,
  }),
  searchMessages: vi.fn().mockResolvedValue({
    items: [
      {
        messageId: "msg-1",
        conversationId: "conv-1",
        bodyPreview: "Oi, preciso de ajuda",
        direction: "inbound",
        status: "sent",
        createdAt: "2026-06-12T12:00:00.000Z",
        matchedText: "aju",
      },
    ],
    nextCursor: null,
    hasMore: false,
  }),
  markConversationAsRead: vi.fn().mockResolvedValue(undefined),
  listRecentSearches: vi.fn().mockResolvedValue([]),
  saveRecentSearch: vi.fn().mockResolvedValue(undefined),
  clearRecentSearches: vi.fn().mockResolvedValue(undefined),
  suggestReply: vi.fn().mockResolvedValue({
    suggestion: "Claro, posso ajudar com isso.",
    source: "openai",
    blocked: false,
    riskLevel: "low",
    riskReasons: [],
    userMessage: null,
  }),
  getAiUsage: vi.fn().mockResolvedValue({
    summary: {
      totalInteractions: 5,
      completedInteractions: 4,
      blockedInteractions: 1,
      promptTokens: 1200,
      completionTokens: 800,
      totalTokens: 2000,
      estimatedCost: 0.0008,
      estimatedCostUsd: 0.0008,
      avgDurationMs: 950,
    },
    byModel: [
      {
        model: "gpt-4o-mini",
        interactions: 4,
        totalTokens: 2000,
        estimatedCost: 0.0008,
        estimatedCostUsd: 0.0008,
      },
    ],
    recent: {
      items: [
        {
          id: "log-1",
          createdAt: "2026-06-13T10:00:00.000Z",
          conversationId: "conv-1",
          stage: "auto_reply",
          model: "gpt-4o-mini",
          source: "openai",
          provider: "openai",
          riskLevel: "low",
          blocked: false,
          promptTokens: 300,
          cachedPromptTokens: 0,
          completionTokens: 200,
          totalTokens: 500,
          estimatedCost: 0.000225,
          estimatedCostUsd: 0.000225,
          durationMs: 900,
        },
      ],
      nextCursor: null,
      hasNextPage: false,
    },
  }),
};

beforeAll(async () => {
  app = await buildApp({ inboxService });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /me", () => {
  it("retorna o perfil consumido pelo frontend", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: "tenant-1",
      name: "NeoFibra",
      role: "Inbox real",
      capabilities: {
        sendMessage: false,
        aiSuggestion: true,
      },
    });
  });
});

describe("GET /conversations", () => {
  it("retorna a lista real de conversas", async () => {
    const res = await app.inject({ method: "GET", url: "/conversations" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: "conv-1",
        contactName: "Maria",
        contactPhone: "5511999999999",
        avatarColor: "#2F855A",
        unread: 0,
        lastMessage: "Oi, preciso de ajuda",
        lastMessageAt: "2026-06-12T12:00:00.000Z",
      },
    ]);
  });
});

describe("recent searches", () => {
  it("GET /recent-searches retorna os recentes do operador atual", async () => {
    const res = await app.inject({ method: "GET", url: "/recent-searches" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST /recent-searches salva somente targetType e targetId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/recent-searches",
      payload: { targetType: "conversation", targetId: "conv-1" },
    });

    expect(res.statusCode).toBe(204);
    expect(inboxService.saveRecentSearch).toHaveBeenCalledWith(
      "conversation",
      "conv-1"
    );
  });

  it("DELETE /recent-searches limpa os recentes do operador atual", async () => {
    const res = await app.inject({ method: "DELETE", url: "/recent-searches" });

    expect(res.statusCode).toBe(204);
    expect(inboxService.clearRecentSearches).toHaveBeenCalledTimes(1);
  });
});

describe("GET /contacts", () => {
  it("retorna os contatos do tenant atual", async () => {
    const res = await app.inject({ method: "GET", url: "/contacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: "contact-1",
        name: "Maria",
        phone: "5511999999999",
        profileName: "Maria",
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T12:00:00.000Z",
      },
    ]);
  });

  it("encaminha a busca opcional", async () => {
    const res = await app.inject({ method: "GET", url: "/contacts?q=maria" });

    expect(res.statusCode).toBe(200);
    expect(inboxService.listContacts).toHaveBeenCalledWith("maria");
  });
});

describe("GET /conversations/:id/messages", () => {
  it("retorna o histórico da conversa", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/conversations/conv-1/messages",
    });

    expect(res.statusCode).toBe(200);
    expect(inboxService.listMessagesPage).toHaveBeenCalledWith("conv-1", {
      limit: undefined,
      before: undefined,
    });
    expect(res.json()).toEqual({
      items: [
        {
          id: "msg-1",
          direction: "in",
          body: "Oi, preciso de ajuda",
          status: "sent",
          createdAt: "2026-06-12T12:00:00.000Z",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("repassa limit e before do querystring ao service", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/conversations/conv-1/messages?limit=10&before=abc123",
    });

    expect(res.statusCode).toBe(200);
    expect(inboxService.listMessagesPage).toHaveBeenCalledWith("conv-1", {
      limit: 10,
      before: "abc123",
    });
  });
});

describe("GET /conversations/:id/messages/search", () => {
  it("repassa q/limit/cursor e retorna o envelope paginado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/conversations/conv-1/messages/search?q=aju&date=2026-06-15&limit=20&cursor=abc",
    });

    expect(res.statusCode).toBe(200);
    expect(inboxService.searchMessages).toHaveBeenCalledWith("conv-1", {
      q: "aju",
      date: "2026-06-15",
      limit: 20,
      cursor: "abc",
    });
    expect(res.json()).toMatchObject({
      items: [{ messageId: "msg-1", matchedText: "aju" }],
      nextCursor: null,
      hasMore: false,
    });
  });
});

describe("POST /conversations/:id/read", () => {
  it("marca a conversa como lida para o operador atual", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/conversations/conv-1/read",
    });

    expect(res.statusCode).toBe(204);
    expect(inboxService.markConversationAsRead).toHaveBeenCalledWith("conv-1");
  });
});

describe("POST /ai/suggest", () => {
  it("retorna a sugestao gerada no backend", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ai/suggest",
      payload: {
        conversationId: "conv-1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(inboxService.suggestReply).toHaveBeenCalledWith("conv-1");
    expect(res.json()).toEqual({
      suggestion: "Claro, posso ajudar com isso.",
      source: "openai",
      blocked: false,
      riskLevel: "low",
      riskReasons: [],
      userMessage: null,
    });
  });
});

describe("GET /ai/usage", () => {
  it("repassa from/to/filtros/cursor/limit e retorna {summary,byModel,recent}", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/ai/usage?from=2026-06-07T00:00:00.000Z&to=2026-06-14T00:00:00.000Z&conversationId=conv-1&limit=10&cursor=abc&model=gpt-5.4&source=openai&provider=openai&riskLevel=low&blocked=false&stage=auto_reply",
    });

    expect(res.statusCode).toBe(200);
    expect(inboxService.getAiUsage).toHaveBeenCalledWith({
      from: "2026-06-07T00:00:00.000Z",
      to: "2026-06-14T00:00:00.000Z",
      conversationId: "conv-1",
      limit: 10,
      cursor: "abc",
      model: "gpt-5.4",
      source: "openai",
      provider: "openai",
      riskLevel: "low",
      blocked: false,
      stage: "auto_reply",
    });

    const body = res.json();
    expect(body.summary).toMatchObject({
      totalInteractions: 5,
      blockedInteractions: 1,
      totalTokens: 2000,
      estimatedCost: 0.0008,
      estimatedCostUsd: 0.0008,
    });
    expect(body.byModel[0]).toMatchObject({ model: "gpt-4o-mini" });
  });

  it("a resposta NÃO expõe prompt, mensagem crua ou token de API", async () => {
    const res = await app.inject({ method: "GET", url: "/ai/usage" });
    const raw = res.payload;
    expect(raw).not.toMatch(/prompt"\s*:/i);
    expect(raw).not.toMatch(/api[_-]?key/i);
    expect(raw).not.toMatch(/authorization/i);
    expect(raw).not.toMatch(/"body"\s*:/i);
    // campos seguros do recent presentes
    expect(res.json().recent.items[0]).toHaveProperty("totalTokens");
  });
});
