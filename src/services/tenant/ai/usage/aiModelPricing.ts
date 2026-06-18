/**
 * Tabela de preços por modelo para **custo estimado** da LLM.
 *
 * estimatedCost is approximate and based on configured model pricing.
 * Valores em USD por 1.000.000 tokens (input/output), mantidos em código de propósito
 * (sem billing real). Modelo fora desta tabela → custo `null` (tokens continuam a
 * métrica principal). Ajuste os números conforme o provedor/contrato real.
 */
export interface ModelPrice {
  /** USD por 1M tokens de entrada (prompt). */
  inputUsdPer1M: number;
  /** USD por 1M tokens de entrada em cache. */
  cachedInputUsdPer1M: number;
  /** USD por 1M tokens de saída (completion). */
  outputUsdPer1M: number;
}

export type AiProcessingMode = "standard" | "batch" | "data_residency";

interface ModelPricingEntry extends ModelPrice {
  aliases: readonly string[];
}

const AI_MODEL_PRICING: readonly ModelPricingEntry[] = [
  {
    aliases: ["gpt-5.4"],
    inputUsdPer1M: 2.5,
    cachedInputUsdPer1M: 0.25,
    outputUsdPer1M: 15,
  },
  {
    aliases: ["gpt-5.4-mini"],
    inputUsdPer1M: 0.75,
    cachedInputUsdPer1M: 0.075,
    outputUsdPer1M: 4.5,
  },
  {
    aliases: ["gpt-5.4-nano"],
    inputUsdPer1M: 0.2,
    cachedInputUsdPer1M: 0.02,
    outputUsdPer1M: 1.25,
  },
  {
    aliases: ["gpt-4o"],
    inputUsdPer1M: 5,
    cachedInputUsdPer1M: 2.5,
    outputUsdPer1M: 15,
  },
  {
    aliases: ["gpt-4o-mini"],
    inputUsdPer1M: 0.15,
    cachedInputUsdPer1M: 0.075,
    outputUsdPer1M: 0.6,
  },
  {
    aliases: ["gpt-4.1"],
    inputUsdPer1M: 2,
    cachedInputUsdPer1M: 0.5,
    outputUsdPer1M: 8,
  },
  {
    aliases: ["gpt-4.1-mini"],
    inputUsdPer1M: 0.4,
    cachedInputUsdPer1M: 0.1,
    outputUsdPer1M: 1.6,
  },
  {
    aliases: ["gpt-3.5-turbo"],
    inputUsdPer1M: 0.5,
    cachedInputUsdPer1M: 0.5,
    outputUsdPer1M: 1.5,
  },
];

const PROCESSING_MODE_MULTIPLIERS: Readonly<Record<AiProcessingMode, number>> = {
  standard: 1,
  batch: 0.5,
  data_residency: 1.1,
};

/**
 * Custo estimado (USD) de uma chamada. `null` quando o modelo é desconhecido ou
 * não há tokens (não inventa valor financeiro). Tokens null contam como 0.
 */
export function estimateCostUsd(
  model: string | null | undefined,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
  cachedPromptTokens: number | null | undefined = 0,
  processingMode: AiProcessingMode = "standard"
): number | null {
  if (!model) return null;
  const price = resolveModelPrice(model);
  if (!price) return null;

  if (promptTokens == null && completionTokens == null) return null;

  const prompt = normalizeTokenCount(promptTokens);
  const cachedPrompt = Math.min(normalizeTokenCount(cachedPromptTokens), prompt);
  const completion = normalizeTokenCount(completionTokens);
  const billableInputTokens = Math.max(prompt - cachedPrompt, 0);
  const inputCost = (billableInputTokens / 1_000_000) * price.inputUsdPer1M;
  const cachedInputCost =
    (cachedPrompt / 1_000_000) * price.cachedInputUsdPer1M;
  const outputCost = (completion / 1_000_000) * price.outputUsdPer1M;
  const cost =
    (inputCost + cachedInputCost + outputCost) *
    PROCESSING_MODE_MULTIPLIERS[processingMode];

  // 6 casas: custos por chamada são pequenos; evita ruído de ponto flutuante.
  return Math.round((cost + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function resolveModelPrice(
  model: string | null | undefined
): ModelPrice | null {
  const normalized = normalizeModelName(model);
  if (!normalized) return null;

  const entriesBySpecificity = [...AI_MODEL_PRICING].sort(
    (a, b) => longestAliasLength(b) - longestAliasLength(a)
  );
  const entry = entriesBySpecificity.find((candidate) =>
    candidate.aliases.some((alias) => matchesModelAlias(normalized, alias))
  );

  if (!entry) return null;
  return {
    inputUsdPer1M: entry.inputUsdPer1M,
    cachedInputUsdPer1M: entry.cachedInputUsdPer1M,
    outputUsdPer1M: entry.outputUsdPer1M,
  };
}

function matchesModelAlias(model: string, alias: string): boolean {
  return model === alias || model.startsWith(`${alias}-`);
}

function longestAliasLength(entry: ModelPricingEntry): number {
  return Math.max(...entry.aliases.map((alias) => alias.length));
}

function normalizeModelName(model: string | null | undefined): string | null {
  const normalized = model?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeTokenCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
