import type { AiProviderInput, AiProviderResult } from "../AiTypes.js";

/**
 * Contrato do provedor de IA. Implementado por OpenAiProvider (real) e
 * StubAiProvider (sem OPENAI_API_KEY / testes), selecionados por factory.
 */
export interface AiProvider {
  readonly source: AiProviderResult["source"];
  generateReply(input: AiProviderInput): Promise<AiProviderResult>;
}
