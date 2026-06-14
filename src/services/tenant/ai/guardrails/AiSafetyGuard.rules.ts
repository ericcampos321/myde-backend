import type { AiGuardrailRule } from "../../../../types/tenant/ai/AiGuardrailTypes.js";

export const MAX_INPUT_CHARS = 4000;
export const RECURRING_ABUSE_THRESHOLD = 3;

export const PROMPT_INJECTION_RULES: AiGuardrailRule[] = [
  {
    id: "prompt_injection_ignore_previous_instructions",
    reason: "prompt_injection",
    riskLevel: "high",
    action: "block",
    patterns: [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /disregard\s+previous\s+instructions/i,
      /ignore\s+the\s+instructions/i,
      /ignore\s+as\s+instru[cç][õo]es\s+anteriores/i,
      /desconsidere\s+(suas\s+)?regras/i,
      /esque[cç]a\s+as\s+regras/i,
      /aja\s+como\s+outro\s+sistema/i,
      /jailbreak/i,
      /developer\s+message/i,
      /system\s+prompt/i,
      /reveal\s+your\s+system\s+prompt/i,
      /mostre\s+seu\s+prompt/i,
    ],
  },
];

export const SECRET_EXTRACTION_RULES: AiGuardrailRule[] = [
  {
    id: "secret_extraction_sensitive_credentials",
    reason: "secret_extraction",
    riskLevel: "high",
    action: "block",
    patterns: [
      /\btoken\b/i,
      /\bapi\s*key\b/i,
      /chave\s+da\s+api/i,
      /\bsegredo\b/i,
      /\bsecret\b/i,
      /\bauthorization\b/i,
      /\bbearer\b/i,
      /webhook\s+secret/i,
      /meta\s+token/i,
      /openai\s+key/i,
      /senha\s+interna/i,
      /credenciais/i,
    ],
  },
];

export const BUSINESS_SCOPE_RULES: AiGuardrailRule[] = [
  {
    id: "business_scope_bypass_discount_or_promo",
    reason: "business_scope_bypass",
    riskLevel: "medium",
    action: "flag",
    patterns: [
      /confirma\s+(que\s+)?(eu\s+tenho\s+)?desconto/i,
      /desconto\s+de\s+90%/i,
      /90%\s+de\s+desconto/i,
      /aprova\s+desconto/i,
      /desconto\s+aprovado/i,
      /contrato\s+sem\s+fidelidade\s+sem\s+taxa/i,
      /confirma\s+instala[cç][aã]o\s+gr[aá]tis\s+fora\s+da\s+regra/i,
      /altera\s+pre[cç]o/i,
      /libera\s+plano\s+sem\s+pagar/i,
      /invente\s+uma\s+promo[cç][aã]o/i,
    ],
  },
];

export const POLICY_BYPASS_RULES: AiGuardrailRule[] = [
  {
    id: "policy_bypass_out_of_scope_request",
    reason: "policy_bypass",
    riskLevel: "medium",
    action: "flag",
    patterns: [
      /responda\s+como\s+advogado/i,
      /orienta[cç][aã]o\s+jur[ií]dica/i,
      /diagn[oó]stico\s+m[eé]dico/i,
      /assunto\s+fora\s+do\s+atendimento/i,
      /conte[uú]do\s+fora\s+do\s+escopo\s+da\s+empresa/i,
      /me\s+d[eê]\s+conselho\s+m[eé]dico/i,
    ],
  },
];

export const TOOL_ABUSE_RULES: AiGuardrailRule[] = [
  {
    id: "tool_abuse_intrusion_or_malware",
    reason: "tool_abuse",
    riskLevel: "high",
    action: "block",
    patterns: [
      /fa[cç]a\s+um\s+c[oó]digo\s+para\s+invadir/i,
      /gere\s+malware/i,
      /roubar\s+senha/i,
      /burlar\s+sistema/i,
      /invadir\s+sistema/i,
      /hackear\s+sistema/i,
    ],
  },
];

export const OUTPUT_LEAK_RULES: AiGuardrailRule[] = [
  {
    id: "output_leak_internal_or_secret_material",
    reason: "secret_extraction",
    riskLevel: "high",
    action: "block",
    patterns: [
      /system\s+prompt/i,
      /developer\s+message/i,
      /\bapi\s*key\b/i,
      /\btoken\b/i,
      /authorization\s+bearer/i,
      /openai\s+key/i,
      /meta\s+token/i,
      /webhook\s+secret/i,
      /instru[cç][õo]es\s+internas/i,
    ],
  },
];

export const COST_ABUSE_RULE: AiGuardrailRule = {
  id: "cost_abuse_input_too_large",
  reason: "cost_abuse",
  riskLevel: "high",
  action: "block",
  patterns: [],
};

export const RECURRING_ABUSE_RULE: AiGuardrailRule = {
  id: "recurring_abuse_threshold_reached",
  reason: "recurring_abuse",
  riskLevel: "high",
  action: "block",
  patterns: [],
};
