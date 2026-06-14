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
  listMessages: vi.fn().mockResolvedValue([
    {
      id: "msg-1",
      direction: "in",
      body: "Oi, preciso de ajuda",
      status: "sent",
      createdAt: "2026-06-12T12:00:00.000Z",
    },
  ]),
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
    expect(inboxService.listMessages).toHaveBeenCalledWith("conv-1");
    expect(res.json()).toEqual([
      {
        id: "msg-1",
        direction: "in",
        body: "Oi, preciso de ajuda",
        status: "sent",
        createdAt: "2026-06-12T12:00:00.000Z",
      },
    ]);
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
