import type {
  AiGuardrailRule,
  AiInputAnalysisInput,
  AiOutputValidationInput,
  AiRiskAction,
  AiRiskLevel,
  AiSafetyDecision,
} from "../../../../types/tenant/ai/AiGuardrailTypes.js";
import {
  BUSINESS_SCOPE_RULES,
  COST_ABUSE_RULE,
  MAX_INPUT_CHARS,
  OUTPUT_LEAK_RULES,
  POLICY_BYPASS_RULES,
  PROMPT_INJECTION_RULES,
  RECURRING_ABUSE_RULE,
  RECURRING_ABUSE_THRESHOLD,
  SECRET_EXTRACTION_RULES,
  TOOL_ABUSE_RULES,
} from "./AiSafetyGuard.rules.js";

const INPUT_RULESETS: readonly AiGuardrailRule[][] = [
  PROMPT_INJECTION_RULES,
  SECRET_EXTRACTION_RULES,
  BUSINESS_SCOPE_RULES,
  POLICY_BYPASS_RULES,
  TOOL_ABUSE_RULES,
];

const ALLOW_DECISION: AiSafetyDecision = {
  action: "allow",
  riskLevel: "low",
  riskReasons: [],
  matchedRules: [],
  blocked: false,
};

export class AiSafetyGuardService {
  analyzeInput(input: AiInputAnalysisInput): AiSafetyDecision {
    const text = input.text ?? "";
    const matchedRules = collectMatchedRules(text, INPUT_RULESETS);

    if (text.length > MAX_INPUT_CHARS) {
      matchedRules.push(COST_ABUSE_RULE);
    }

    if ((input.recentHighRiskCount ?? 0) >= RECURRING_ABUSE_THRESHOLD) {
      matchedRules.push(RECURRING_ABUSE_RULE);
    }

    return buildDecision(matchedRules);
  }

  validateOutput(input: AiOutputValidationInput): AiSafetyDecision {
    const text = input.text ?? "";
    const matchedRules = collectMatchedRules(text, [OUTPUT_LEAK_RULES]);

    return buildDecision(matchedRules);
  }
}

function collectMatchedRules(
  text: string,
  rulesets: readonly AiGuardrailRule[][]
): AiGuardrailRule[] {
  const matches: AiGuardrailRule[] = [];

  for (const rules of rulesets) {
    for (const rule of rules) {
      if (rule.patterns.some((pattern) => pattern.test(text))) {
        matches.push(rule);
      }
    }
  }

  return matches;
}

function buildDecision(matchedRules: readonly AiGuardrailRule[]): AiSafetyDecision {
  if (matchedRules.length === 0) {
    return { ...ALLOW_DECISION };
  }

  const action = resolveAction(matchedRules);
  const riskLevel = resolveRiskLevel(matchedRules);

  return {
    action,
    riskLevel,
    riskReasons: [...new Set(matchedRules.map((rule) => rule.reason))],
    matchedRules: [...new Set(matchedRules.map((rule) => rule.id))],
    blocked: action === "block",
  };
}

function resolveAction(matchedRules: readonly AiGuardrailRule[]): AiRiskAction {
  if (matchedRules.some((rule) => rule.action === "block")) {
    return "block";
  }

  if (matchedRules.some((rule) => rule.action === "flag")) {
    return "flag";
  }

  return "allow";
}

function resolveRiskLevel(matchedRules: readonly AiGuardrailRule[]): AiRiskLevel {
  if (matchedRules.some((rule) => rule.riskLevel === "high")) {
    return "high";
  }

  if (matchedRules.some((rule) => rule.riskLevel === "medium")) {
    return "medium";
  }

  return "low";
}
