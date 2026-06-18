import OpenAI from "openai";
import { env } from "../../../../config/env.js";
import { AppError } from "../../../../errors/AppError.js";
import { createLogger } from "../../../../shared/logger/logger.js";
import type { AiProviderInput, AiProviderResult } from "../../../../types/tenant/ai/AiTypes.js";
import type { AiProvider } from "./AiProvider.js";

const log = createLogger({ module: "openai-provider" });

const MAX_OUTPUT_TOKENS = 350;

/**
 * Modelos novos (gpt-5*) e de raciocínio (o-series: o1/o3/o4...) NÃO aceitam
 * `max_tokens` — exigem `max_completion_tokens` — e normalmente só permitem a
 * `temperature` padrão. Modelos legados (gpt-4o, gpt-4, gpt-3.5...) seguem com
 * `max_tokens` + `temperature` custom.
 */
export function usesMaxCompletionTokens(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith("gpt-5") || /^o\d/.test(m);
}

export interface OpenAiProviderOptions {
  client?: OpenAI;
  model?: string;
}

export class OpenAiProvider implements AiProvider {
  readonly source = "openai" as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions = {}) {
    if (options.client) {
      // Cliente injetado (testes): não exige a chave real.
      this.client = options.client;
    } else {
      if (!env.OPENAI_API_KEY) {
        throw new Error(
          "OPENAI_API_KEY is required to instantiate OpenAiProvider."
        );
      }
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
    this.model = options.model ?? env.OPENAI_MODEL;
  }

  /** Monta os parâmetros de limite de saída/temperatura conforme o modelo. */
  buildTokenParams(): Partial<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming> {
    if (usesMaxCompletionTokens(this.model)) {
      // Sem `temperature`: modelos novos/razonadores só aceitam o default.
      return { max_completion_tokens: MAX_OUTPUT_TOKENS };
    }
    return { max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.2 };
  }

  async generateReply(input: AiProviderInput): Promise<AiProviderResult> {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      ...this.buildTokenParams(),
      messages: [
        {
          role: "system",
          content: buildOpenAiSystemMessage(input),
        },
        ...input.conversationHistory.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        {
          role: "user",
          content: input.userMessage,
        },
      ],
    };

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create(params);
    } catch (error) {
      this.throwSafeProviderError(error);
    }

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      log.error({ model: this.model }, "[openai] resposta vazia");
      throw new AppError({
        code: "AI_PROVIDER_EMPTY_RESPONSE",
        message: "A IA não retornou conteúdo. Tente novamente.",
        statusCode: 502,
      });
    }

    // Usage de tokens (controle de custo). Null quando a API não retorna usage —
    // não quebra o fluxo. Nunca logamos/retornamos conteúdo, só contagens.
    const usage = completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens ?? null,
          cachedPromptTokens: getCachedPromptTokens(completion.usage),
          completionTokens: completion.usage.completion_tokens ?? null,
          totalTokens: completion.usage.total_tokens ?? null,
        }
      : null;

    return { source: this.source, text, model: this.model, usage };
  }

  /**
   * Converte erro do SDK em AppError amigável. Loga apenas metadados seguros
   * (status, code, param, type, request_id) — NUNCA prompt, mensagens ou token.
   */
  private throwSafeProviderError(error: unknown): never {
    if (error instanceof OpenAI.APIError) {
      log.error(
        {
          model: this.model,
          status: error.status,
          code: error.code,
          param: error.param,
          type: error.type,
          requestId: error.request_id,
        },
        "[openai] erro da API"
      );
    } else {
      log.error(
        {
          model: this.model,
          error: error instanceof Error ? error.message : "unknown",
        },
        "[openai] erro inesperado"
      );
    }

    throw new AppError({
      code: "AI_PROVIDER_ERROR",
      message: "Falha ao gerar resposta de IA. Tente novamente em instantes.",
      statusCode: 502,
    });
  }
}

function getCachedPromptTokens(
  usage: NonNullable<OpenAI.Chat.ChatCompletion["usage"]>
): number | null {
  const promptTokensDetails = usage.prompt_tokens_details as
    | { cached_tokens?: unknown }
    | undefined;
  const cachedTokens = promptTokensDetails?.cached_tokens;
  return typeof cachedTokens === "number" && Number.isFinite(cachedTokens)
    ? cachedTokens
    : null;
}

function buildOpenAiSystemMessage(input: AiProviderInput): string {
  return [
    input.systemPrompt,
    "",
    "Regras obrigatórias:",
    "- Responda em pt-BR.",
    "- Use apenas as informações da base de conhecimento abaixo.",
    "- Se a resposta não estiver na base, diga isso claramente e ofereça encaminhamento para atendente humano.",
    "- Não invente preços, prazos, políticas, cobertura ou procedimentos.",
    "",
    "Base de conhecimento:",
    input.knowledgeBaseContext,
  ].join("\n");
}
