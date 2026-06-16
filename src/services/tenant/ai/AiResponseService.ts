import { env, hasOpenAi } from "../../../config/env.js";
import type {
  AiConversationTurn,
  AiProviderResult,
  AiResponseConversationMessage,
  AiResponseInput,
  AiResponseResult,
} from "../../../types/tenant/ai/AiTypes.js";
import { KnowledgeBaseService } from "./KnowledgeBaseService.js";
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
    const knowledgeBaseContext = await this.dependencies.knowledgeBaseService.getContext();
    // Métricas de grounding (RAG): quantos documentos e quanto contexto foram
    // usados. `loadDocuments` é cacheado pelo KnowledgeBaseService.
    const documents = await this.dependencies.knowledgeBaseService.loadDocuments();

    const result = await this.dependencies.provider.generateReply({
      systemPrompt: this.systemPrompt,
      knowledgeBaseContext,
      conversationHistory: limitConversationHistory(input.conversationHistory, this.historyLimit),
      userMessage: input.currentMessage,
    });

    return {
      ...result,
      contextItemsCount: documents.length,
      contextChars: knowledgeBaseContext.length,
    };
  }
}

export function createAiResponseService(dependencies: AiResponseServiceDependencies = {}): AiResponseService {
  const provider = dependencies.provider ?? createAiProvider();

  return new AiResponseService({
    provider,
    knowledgeBaseService: dependencies.knowledgeBaseService ?? new KnowledgeBaseService(),
    historyLimit: dependencies.historyLimit ?? DEFAULT_HISTORY_LIMIT,
    systemPrompt: dependencies.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  });
}

/**
 * Decide qual provider de IA usar. Função pura (sem instanciar providers) para
 * ser testável. Sem `OPENAI_API_KEY`, o stub só é aceitável em `NODE_ENV=test`;
 * em desenvolvimento/produção falhamos de forma explícita em vez de mascarar a
 * ausência da chave real com um mock silencioso.
 */
export function selectAiProviderKind(params: { hasOpenAiKey: boolean; nodeEnv: string }): "openai" | "stub" {
  if (params.hasOpenAiKey) {
    return "openai";
  }
  if (params.nodeEnv === "test") {
    return "stub";
  }
  throw new Error(
    "[ai] OPENAI_API_KEY ausente. Configure a chave real no .env local para " +
      "habilitar as respostas de IA. O StubAiProvider só é usado em NODE_ENV=test."
  );
}

export function createAiProvider(): AiProvider {
  const kind = selectAiProviderKind({
    hasOpenAiKey: hasOpenAi,
    nodeEnv: env.NODE_ENV,
  });
  return kind === "openai" ? new OpenAiProvider() : new StubAiProvider();
}

function limitConversationHistory(history: AiResponseConversationMessage[], historyLimit: number): AiConversationTurn[] {
  return history
    .filter((message) => message.body.trim().length > 0)
    .slice(-historyLimit)
    .map((message) => ({
      role: message.direction === "inbound" ? "user" : "assistant",
      content: message.body,
    }));
}
