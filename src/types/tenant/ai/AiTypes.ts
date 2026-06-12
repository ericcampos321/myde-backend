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

export interface AiProviderResult {
  text: string;
  source: AiSource;
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
}
