import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  OpenAiProvider,
  usesMaxCompletionTokens,
} from "./OpenAiProvider.js";
import type { AiProviderInput } from "../../../../types/tenant/ai/AiTypes.js";

const input: AiProviderInput = {
  systemPrompt: "Você é a assistente.",
  knowledgeBaseContext: "Plano Fibra 300.",
  conversationHistory: [{ role: "user", content: "oi" }],
  userMessage: "quais planos?",
};

function fakeClient(create: ReturnType<typeof vi.fn>): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function okResponse(text = "Temos o Fibra 300.") {
  return { choices: [{ message: { content: text } }] };
}

describe("usesMaxCompletionTokens", () => {
  it("true para gpt-5* e o-series", () => {
    expect(usesMaxCompletionTokens("gpt-5.4")).toBe(true);
    expect(usesMaxCompletionTokens("gpt-5")).toBe(true);
    expect(usesMaxCompletionTokens("o1-mini")).toBe(true);
    expect(usesMaxCompletionTokens("o3")).toBe(true);
  });
  it("false para modelos legados", () => {
    expect(usesMaxCompletionTokens("gpt-4o-mini")).toBe(false);
    expect(usesMaxCompletionTokens("gpt-4")).toBe(false);
    expect(usesMaxCompletionTokens("gpt-3.5-turbo")).toBe(false);
  });
});

describe("OpenAiProvider.generateReply", () => {
  it("usa max_completion_tokens (e omite max_tokens/temperature) para gpt-5.4", async () => {
    const create = vi.fn().mockResolvedValue(okResponse());
    const provider = new OpenAiProvider({
      client: fakeClient(create),
      model: "gpt-5.4",
    });

    await provider.generateReply(input);

    const params = create.mock.calls[0]![0];
    expect(params.max_completion_tokens).toBe(350);
    expect(params.max_tokens).toBeUndefined();
    expect(params.temperature).toBeUndefined();
    expect(params.model).toBe("gpt-5.4");
  });

  it("grounding: system prompt manda usar só a KB e dizer quando não souber", async () => {
    const create = vi.fn().mockResolvedValue(okResponse());
    const provider = new OpenAiProvider({
      client: fakeClient(create),
      model: "gpt-5.4",
    });

    await provider.generateReply({
      ...input,
      knowledgeBaseContext: "FATO-KB: plano Fibra 300 custa R$ 79,90.",
    });

    const params = create.mock.calls[0]![0];
    const systemMessage = params.messages.find(
      (m: { role: string }) => m.role === "system"
    )!.content as string;

    // inclui o contexto da knowledge-base
    expect(systemMessage).toContain("FATO-KB: plano Fibra 300 custa R$ 79,90.");
    // instrui a usar apenas a base e a dizer quando não houver resposta
    expect(systemMessage).toContain("apenas as informações da base de conhecimento");
    expect(systemMessage).toMatch(/não estiver na base/i);
    expect(systemMessage).toMatch(/não invente/i);
  });

  it("usa max_tokens + temperature para modelo legado (gpt-4o-mini)", async () => {
    const create = vi.fn().mockResolvedValue(okResponse());
    const provider = new OpenAiProvider({
      client: fakeClient(create),
      model: "gpt-4o-mini",
    });

    await provider.generateReply(input);

    const params = create.mock.calls[0]![0];
    expect(params.max_tokens).toBe(350);
    expect(params.temperature).toBe(0.2);
    expect(params.max_completion_tokens).toBeUndefined();
  });

  it("trata unsupported_parameter da OpenAI como AppError seguro (sem vazar)", async () => {
    const apiError = new OpenAI.APIError(
      400,
      {
        type: "invalid_request_error",
        code: "unsupported_parameter",
        param: "max_tokens",
        message: "Unsupported parameter: 'max_tokens' ...",
      },
      "Unsupported parameter",
      undefined
    );
    const create = vi.fn().mockRejectedValue(apiError);
    const provider = new OpenAiProvider({
      client: fakeClient(create),
      model: "gpt-5.4",
    });

    await expect(provider.generateReply(input)).rejects.toMatchObject({
      code: "AI_PROVIDER_ERROR",
      statusCode: 502,
    });
    // Mensagem amigável, sem prompt/token.
    await expect(provider.generateReply(input)).rejects.toMatchObject({
      message: expect.not.stringContaining("max_tokens"),
    });
  });

  it("resposta vazia vira AppError controlado", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "" } }] });
    const provider = new OpenAiProvider({
      client: fakeClient(create),
      model: "gpt-5.4",
    });

    await expect(provider.generateReply(input)).rejects.toMatchObject({
      code: "AI_PROVIDER_EMPTY_RESPONSE",
      statusCode: 502,
    });
  });

  it("erro inesperado (não-APIError) também vira AppError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    const provider = new OpenAiProvider({
      client: fakeClient(create),
      model: "gpt-4o-mini",
    });

    await expect(provider.generateReply(input)).rejects.toMatchObject({
      code: "AI_PROVIDER_ERROR",
    });
  });
});
