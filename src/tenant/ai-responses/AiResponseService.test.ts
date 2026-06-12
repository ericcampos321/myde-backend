import { describe, expect, it, vi } from "vitest";
import { AiResponseService } from "./AiResponseService.js";
import type { AiProvider } from "./providers/AiProvider.js";

describe("AiResponseService", () => {
  it("converte history inbound/outbound para user/assistant e usa provider injetado", async () => {
    const generateReply = vi.fn().mockResolvedValue({
      source: "stub",
      text: "ok",
    });

    const service = new AiResponseService({
      provider: {
        source: "stub",
        generateReply,
      } satisfies AiProvider,
      knowledgeBaseService: {
        getContext: vi.fn().mockResolvedValue("kb context"),
        loadDocuments: vi.fn(),
      },
      historyLimit: 10,
      systemPrompt: "system prompt",
    });

    const result = await service.generateResponse({
      currentMessage: "Mensagem atual",
      conversationHistory: [
        { direction: "inbound", body: "Oi" },
        { direction: "outbound", body: "Olá, tudo bem?" },
      ],
    });

    expect(result).toEqual({ source: "stub", text: "ok" });
    expect(generateReply).toHaveBeenCalledWith({
      systemPrompt: "system prompt",
      knowledgeBaseContext: "kb context",
      conversationHistory: [
        { role: "user", content: "Oi" },
        { role: "assistant", content: "Olá, tudo bem?" },
      ],
      userMessage: "Mensagem atual",
    });
  });

  it("limita o historico aos ultimos N itens", async () => {
    const generateReply = vi.fn().mockResolvedValue({
      source: "stub",
      text: "ok",
    });

    const service = new AiResponseService({
      provider: {
        source: "stub",
        generateReply,
      } satisfies AiProvider,
      knowledgeBaseService: {
        getContext: vi.fn().mockResolvedValue("kb context"),
        loadDocuments: vi.fn(),
      },
      historyLimit: 2,
      systemPrompt: "system prompt",
    });

    await service.generateResponse({
      currentMessage: "Mensagem atual",
      conversationHistory: [
        { direction: "inbound", body: "m1" },
        { direction: "outbound", body: "m2" },
        { direction: "inbound", body: "m3" },
      ],
    });

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: [
          { role: "assistant", content: "m2" },
          { role: "user", content: "m3" },
        ],
      })
    );
  });
});
