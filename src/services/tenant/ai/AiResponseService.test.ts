import { describe, expect, it, vi } from "vitest";
import { AiResponseService, selectAiProviderKind } from "./AiResponseService.js";
import type { AiProvider } from "./providers/AiProvider.js";

describe("selectAiProviderKind", () => {
  it("usa openai quando há OPENAI_API_KEY (qualquer ambiente)", () => {
    expect(
      selectAiProviderKind({ hasOpenAiKey: true, nodeEnv: "development" })
    ).toBe("openai");
    expect(
      selectAiProviderKind({ hasOpenAiKey: true, nodeEnv: "production" })
    ).toBe("openai");
  });

  it("usa stub apenas em test quando não há chave", () => {
    expect(
      selectAiProviderKind({ hasOpenAiKey: false, nodeEnv: "test" })
    ).toBe("stub");
  });

  it("falha explícito sem chave em desenvolvimento", () => {
    expect(() =>
      selectAiProviderKind({ hasOpenAiKey: false, nodeEnv: "development" })
    ).toThrowError(/OPENAI_API_KEY ausente/);
  });

  it("falha explícito sem chave em produção", () => {
    expect(() =>
      selectAiProviderKind({ hasOpenAiKey: false, nodeEnv: "production" })
    ).toThrowError(/OPENAI_API_KEY ausente/);
  });
});

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
        loadDocuments: vi.fn().mockResolvedValue([
          { name: "a.md", path: "a", content: "x" },
          { name: "b.md", path: "b", content: "y" },
        ]),
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

    // grounding: 2 documentos, contexto "kb context" (10 chars)
    expect(result).toEqual({
      source: "stub",
      text: "ok",
      contextItemsCount: 2,
      contextChars: "kb context".length,
    });
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
        loadDocuments: vi.fn().mockResolvedValue([]),
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
