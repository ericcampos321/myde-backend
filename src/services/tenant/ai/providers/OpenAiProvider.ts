import OpenAI from "openai";
import { env } from "../../../../config/env.js";
import type { AiProviderInput, AiProviderResult } from "../../../../types/tenant/ai/AiTypes.js";
import type { AiProvider } from "./AiProvider.js";

export interface OpenAiProviderOptions {
  client?: OpenAI;
  model?: string;
}

export class OpenAiProvider implements AiProvider {
  readonly source = "openai" as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions = {}) {
    if (!env.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY is required to instantiate OpenAiProvider."
      );
    }

    this.client =
      options.client ??
      new OpenAI({
        apiKey: env.OPENAI_API_KEY,
      });
    this.model = options.model ?? env.OPENAI_MODEL;
  }

  async generateReply(
    input: AiProviderInput
  ): Promise<AiProviderResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      max_tokens: 350,
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
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("OpenAI returned an empty response.");
    }

    return {
      source: this.source,
      text,
    };
  }
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
