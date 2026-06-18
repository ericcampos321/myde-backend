import type { AiRiskLevel } from "./AiGuardrailTypes.js";
import type {
  AiInteractionSource,
  AiInteractionStage,
} from "./AiInteractionTypes.js";

/** Filtro das consultas de uso da IA (tenant-scoped). `to` é exclusivo (`< to`). */
export interface AiUsageFilter {
  tenantId: string;
  from: Date;
  to: Date;
  conversationId?: string | null;
  model?: string | null;
  source?: AiInteractionSource | null;
  provider?: string | null;
  riskLevel?: AiRiskLevel | null;
  blocked?: boolean | null;
  stage?: AiInteractionStage | null;
}

export interface AiUsageRecentCursor {
  createdAt: Date;
  id: string;
}

/** Agregados crus do repositório (sem custo — o service calcula o custo). */
export interface AiUsageSummaryRaw {
  totalInteractions: number;
  blockedInteractions: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number | null;
}

export interface AiUsageByModelRaw {
  model: string | null;
  interactions: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiUsageRecentRow {
  id: string;
  createdAt: Date;
  conversationId: string;
  stage: AiInteractionStage;
  model: string | null;
  source: AiInteractionSource | null;
  provider: string | null;
  riskLevel: AiRiskLevel;
  blocked: boolean;
  promptTokens: number | null;
  cachedPromptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
}

export interface AiUsageRecentRowsPage {
  items: AiUsageRecentRow[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

/** Contrato público (DTO) do painel de uso da IA. */
export interface AiUsageSummary {
  totalInteractions: number;
  completedInteractions: number;
  blockedInteractions: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  estimatedCostUsd: number | null;
  avgDurationMs: number | null;
}

export interface AiUsageByModel {
  model: string | null;
  interactions: number;
  totalTokens: number;
  estimatedCost: number | null;
  estimatedCostUsd: number | null;
}

export interface AiUsageRecentItem {
  id: string;
  createdAt: string;
  conversationId: string;
  stage: AiInteractionStage;
  model: string | null;
  source: AiInteractionSource | null;
  provider: string | null;
  riskLevel: AiRiskLevel;
  blocked: boolean;
  promptTokens: number | null;
  cachedPromptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
}

export interface AiUsageRecentPage {
  items: AiUsageRecentItem[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface AiUsageResult {
  summary: AiUsageSummary;
  byModel: AiUsageByModel[];
  recent: AiUsageRecentPage;
}
