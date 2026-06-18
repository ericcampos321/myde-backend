export type AiRiskLevel = "low" | "medium" | "high";

export type AiRiskAction = "allow" | "flag" | "block";

export type AiRiskReason =
  | "prompt_injection"
  | "secret_extraction"
  | "secret_exfiltration"
  | "business_scope_bypass"
  | "policy_bypass"
  | "tool_abuse"
  | "cost_abuse"
  | "recurring_abuse";

export interface AiSafetyDecision {
  action: AiRiskAction;
  riskLevel: AiRiskLevel;
  riskReasons: AiRiskReason[];
  matchedRules: string[];
  blocked: boolean;
}

export interface AiInputAnalysisInput {
  text: string;
  recentHighRiskCount?: number;
}

export interface AiOutputValidationInput {
  text: string;
}

export interface AiGuardrailRule {
  id: string;
  reason: AiRiskReason;
  riskLevel: AiRiskLevel;
  action: AiRiskAction;
  patterns: RegExp[];
}
