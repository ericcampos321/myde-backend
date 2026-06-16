import { AiInteractionLogRepository } from "../../../../repositories/tenant/ai/index.js";
import type {
  AiUsageByModel,
  AiUsageFilter,
  AiUsageResult,
} from "../../../../types/tenant/ai/AiUsageTypes.js";
import { decodeAiUsageCursor } from "./aiUsageCursor.js";
import { estimateCostUsd } from "./aiModelPricing.js";

type AiUsageRepositoryContract = Pick<
  AiInteractionLogRepository,
  "getUsageSummary" | "getUsageByModel" | "listRecentUsage"
>;

/**
 * Monta o painel de uso da IA (read-only) a partir dos agregados do repositório.
 * Aplica o custo estimado por modelo (aproximado, ver `aiModelPricing`). Não
 * expõe prompt, mensagem ou resposta — apenas contagens/metadados seguros.
 */
export class AiUsageService {
  constructor(
    private readonly repository: AiUsageRepositoryContract = new AiInteractionLogRepository()
  ) {}

  async getUsage(
    filter: AiUsageFilter,
    limit: number,
    cursor?: string | null
  ): Promise<AiUsageResult> {
    const decodedCursor = decodeAiUsageCursor(cursor);
    const [summaryRaw, byModelRaw, recentPage] = await Promise.all([
      this.repository.getUsageSummary(filter),
      this.repository.getUsageByModel(filter),
      this.repository.listRecentUsage(filter, limit, decodedCursor),
    ]);

    const byModel: AiUsageByModel[] = byModelRaw.map((m) => {
      const estimatedCostUsd = estimateCostUsd(
        m.model,
        m.promptTokens,
        m.completionTokens,
        m.cachedPromptTokens
      );
      return {
        model: m.model,
        interactions: m.interactions,
        totalTokens: m.totalTokens,
        estimatedCost: estimatedCostUsd,
        estimatedCostUsd,
      };
    });

    // Custo total = soma dos modelos com preço conhecido; null se nenhum tem preço.
    let estimatedCost: number | null = null;
    for (const m of byModel) {
      if (m.estimatedCost != null) {
        estimatedCost = (estimatedCost ?? 0) + m.estimatedCost;
      }
    }
    if (estimatedCost != null) {
      estimatedCost = Math.round(estimatedCost * 1_000_000) / 1_000_000;
    }

    return {
      summary: {
        totalInteractions: summaryRaw.totalInteractions,
        completedInteractions:
          summaryRaw.totalInteractions - summaryRaw.blockedInteractions,
        blockedInteractions: summaryRaw.blockedInteractions,
        promptTokens: summaryRaw.promptTokens,
        completionTokens: summaryRaw.completionTokens,
        totalTokens: summaryRaw.totalTokens,
        estimatedCost,
        estimatedCostUsd: estimatedCost,
        avgDurationMs:
          summaryRaw.avgDurationMs == null
            ? null
            : Math.round(summaryRaw.avgDurationMs),
      },
      byModel,
      recent: {
        items: recentPage.items.map((r) => {
          const estimatedCostUsd = estimateCostUsd(
            r.model,
            r.promptTokens,
            r.completionTokens,
            r.cachedPromptTokens
          );
          return {
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            conversationId: r.conversationId,
            stage: r.stage,
            model: r.model,
            source: r.source,
            provider: r.provider,
            riskLevel: r.riskLevel,
            blocked: r.blocked,
            promptTokens: r.promptTokens,
            cachedPromptTokens: r.cachedPromptTokens,
            completionTokens: r.completionTokens,
            totalTokens: r.totalTokens,
            estimatedCost: estimatedCostUsd,
            estimatedCostUsd,
            durationMs: r.durationMs,
          };
        }),
        nextCursor: recentPage.nextCursor,
        hasNextPage: recentPage.hasNextPage,
      },
    };
  }
}
