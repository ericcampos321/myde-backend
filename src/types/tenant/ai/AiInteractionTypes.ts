import type {
  AiRiskAction,
  AiRiskLevel,
  AiRiskReason,
} from "./AiGuardrailTypes.js";

export type AiInteractionStage = "input" | "output" | "recurring";

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
  promptVersion?: string | null;
  inputCharCount: number;
  outputCharCount?: number | null;
  model?: string | null;
}

export interface AiRecentHighRiskCountInput {
  tenantId: string;
  conversationId: string;
  since: Date;
}
