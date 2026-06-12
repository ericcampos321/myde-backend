import type {
  GenerateReplyInput,
  GenerateReplyResult,
} from "../AiTypes.js";

/**
 * Contrato do provedor de IA. Implementado por OpenAiProvider (real) e
 * StubAiProvider (sem OPENAI_API_KEY / testes), selecionados por factory.
 */
export interface AiProvider {
  generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult>;
}
