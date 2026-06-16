/** Origem da resposta gerada — diferencia OpenAI real do stub. */
export type AiSource = "openai" | "stub";

export interface KnowledgeBaseDocument {
  name: string;
  path: string;
  content: string;
}

export interface AiConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiProviderInput {
  systemPrompt: string;
  knowledgeBaseContext: string;
  conversationHistory: AiConversationTurn[];
  userMessage: string;
}

/**
 * Uso de tokens da LLM (controle de custo). Campos null quando o provedor não
 * retorna usage ou o caminho não chama a IA. Apenas contagens — nunca conteúdo.
 */
export interface AiUsage {
  promptTokens: number | null;
  cachedPromptTokens?: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AiProviderResult {
  text: string;
  source: AiSource;
  model?: string | null;
  usage?: AiUsage | null;
}

export interface AiResponseConversationMessage {
  direction: "inbound" | "outbound";
  body: string;
}

export interface AiResponseInput {
  currentMessage: string;
  conversationHistory: AiResponseConversationMessage[];
}

export interface AiResponseResult {
  text: string;
  source: AiSource;
  model?: string | null;
  usage?: AiUsage | null;
  /** Nº de documentos da base de conhecimento usados como contexto (grounding). */
  contextItemsCount?: number | null;
  /** Tamanho (chars) do contexto de conhecimento enviado ao modelo. */
  contextChars?: number | null;
}
