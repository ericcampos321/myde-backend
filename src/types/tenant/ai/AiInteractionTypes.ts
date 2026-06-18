import type {
  AiRiskAction,
  AiRiskLevel,
  AiRiskReason,
} from "./AiGuardrailTypes.js";

export type AiInteractionStage =
  | "input"
  | "output"
  | "recurring"
  // Resposta gerada pelo worker (auto-reply). Marca a chamada real à LLM no
  // fluxo automático, alimentando o painel de uso/custo. Sem texto/prompt.
  | "auto_reply";

export type AiInteractionSource = "openai" | "stub";

export interface AiInteractionLogCreateInput {
  tenantId: string;
  conversationId: string;
  contactId?: string | null;
  operatorId?: string | null;
  stage: AiInteractionStage;
  action: AiRiskAction;
  riskLevel: AiRiskLevel;
  riskReasons: AiRiskReason[];
  matchedRules: string[];
  blocked: boolean;
  source?: AiInteractionSource | null;
  provider?: string | null;
  promptVersion?: string | null;
  inputCharCount: number;
  outputCharCount?: number | null;
  model?: string | null;
  promptTokens?: number | null;
  cachedPromptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  contextItemsCount?: number | null;
  contextChars?: number | null;
}

export interface AiRecentHighRiskCountInput {
  tenantId: string;
  conversationId: string;
  since: Date;
}
