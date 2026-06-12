import { hasOpenAi } from "../../config/env.js";
import type {
  AiConversationTurn,
  AiProviderResult,
  AiResponseConversationMessage,
  AiResponseInput,
  AiResponseResult,
} from "./AiTypes.js";
import { KnowledgeBaseService } from "./knowledge-base/KnowledgeBaseService.js";
import type { AiProvider } from "./providers/AiProvider.js";
import { OpenAiProvider } from "./providers/OpenAiProvider.js";
import { StubAiProvider } from "./providers/StubAiProvider.js";

const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_SYSTEM_PROMPT = [
  "Você é a assistente virtual da NeoFibra.",
  "Atenda clientes com clareza, objetividade e tom cordial.",
  "Use somente a base de conhecimento fornecida.",
  "Se a informação não estiver disponível, diga que não encontrou e ofereça encaminhamento para atendimento humano.",
].join(" ");

export interface AiResponseServiceDependencies {
  provider?: AiProvider;
  knowledgeBaseService?: Pick<KnowledgeBaseService, "getContext" | "loadDocuments">;
  historyLimit?: number;
  systemPrompt?: string;
}

export class AiResponseService {
  readonly source: AiProviderResult["source"];
  private readonly historyLimit: number;
  private readonly systemPrompt: string;

  constructor(private readonly dependencies: Required<AiResponseServiceDependencies>) {
    this.source = dependencies.provider.source;
    this.historyLimit = dependencies.historyLimit;
    this.systemPrompt = dependencies.systemPrompt;
  }

  async generateResponse(input: AiResponseInput): Promise<AiResponseResult> {
    const knowledgeBaseContext =
      await this.dependencies.knowledgeBaseService.getContext();

    return this.dependencies.provider.generateReply({
      systemPrompt: this.systemPrompt,
      knowledgeBaseContext,
      conversationHistory: limitConversationHistory(
        input.conversationHistory,
        this.historyLimit
      ),
      userMessage: input.currentMessage,
    });
  }
}

export function createAiResponseService(
  dependencies: AiResponseServiceDependencies = {}
): AiResponseService {
  const provider = dependencies.provider ?? createAiProvider();

  return new AiResponseService({
    provider,
    knowledgeBaseService:
      dependencies.knowledgeBaseService ?? new KnowledgeBaseService(),
    historyLimit: dependencies.historyLimit ?? DEFAULT_HISTORY_LIMIT,
    systemPrompt: dependencies.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  });
}

export function createAiProvider(): AiProvider {
  return hasOpenAi ? new OpenAiProvider() : new StubAiProvider();
}

function limitConversationHistory(
  history: AiResponseConversationMessage[],
  historyLimit: number
): AiConversationTurn[] {
  return history
    .filter((message) => message.body.trim().length > 0)
    .slice(-historyLimit)
    .map((message) => ({
      role: message.direction === "inbound" ? "user" : "assistant",
      content: message.body,
    }));
}
