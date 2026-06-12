/** Origem da resposta gerada — diferencia OpenAI real do stub. */
export type AiSource = "openai" | "stub";

export interface AiTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateReplyInput {
  systemPrompt: string;
  history: AiTurn[];
  userMessage: string;
}

export interface GenerateReplyResult {
  text: string;
  source: AiSource;
}
