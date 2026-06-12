import { describe, expect, it } from "vitest";
import { StubAiProvider } from "./StubAiProvider.js";

describe("StubAiProvider", () => {
  const provider = new StubAiProvider();
  const knowledgeBaseContext = [
    "Fibra Start 300 Mbps - R$ 79,90",
    "Fibra Plus 600 Mbps - R$ 99,90",
    "Fibra Max 1 Gbps - R$ 149,90",
    "SLA residencial de 48h úteis",
    "Atendimento via WhatsApp, 0800 e app",
  ].join("\n");

  it("responde sobre planos usando a base", async () => {
    const result = await provider.generateReply({
      systemPrompt: "teste",
      knowledgeBaseContext,
      conversationHistory: [],
      userMessage: "Quais planos e valores voces tem?",
    });

    expect(result.source).toBe("stub");
    expect(result.text).toContain("Fibra Start 300 Mbps - R$ 79,90");
    expect(result.text).toContain("Fibra Max 1 Gbps - R$ 149,90");
  });

  it("retorna fallback seguro quando nao encontra resposta", async () => {
    const result = await provider.generateReply({
      systemPrompt: "teste",
      knowledgeBaseContext,
      conversationHistory: [],
      userMessage: "Qual o nome do CEO da empresa?",
    });

    expect(result).toEqual({
      source: "stub",
      text: "Não encontrei essa informação na base de conhecimento disponível. Posso encaminhar para um atendente humano.",
    });
  });
});
