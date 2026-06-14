import type { AiRiskLevel, AiRiskReason } from "./AiGuardrailTypes.js";
import type { AiSource } from "./AiTypes.js";

export interface AiSuggestionHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface AiSuggestionServiceInput {
  tenantId: string;
  conversationId: string;
  contactId?: string | null;
  operatorId?: string | null;
  userMessage: string;
  history: AiSuggestionHistoryItem[];
  recentHighRiskWindowMinutes?: number;
}

export interface AiSuggestionResult {
  suggestion: string | null;
  source: AiSource | null;
  blocked: boolean;
  riskLevel: AiRiskLevel;
  riskReasons: AiRiskReason[];
  userMessage: string | null;
}
