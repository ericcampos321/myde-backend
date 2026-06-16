import {
  and,
  avg,
  count,
  desc,
  eq,
  gte,
  lt,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import {
  aiInteractionLogs,
  type AiInteractionLogRow,
} from "../../../db/schema/index.js";
import type {
  AiInteractionLogCreateInput,
  AiRecentHighRiskCountInput,
} from "../../../types/tenant/ai/AiInteractionTypes.js";
import type {
  AiUsageByModelRaw,
  AiUsageFilter,
  AiUsageRecentCursor,
  AiUsageRecentRow,
  AiUsageRecentRowsPage,
  AiUsageSummaryRaw,
} from "../../../types/tenant/ai/AiUsageTypes.js";
import { encodeAiUsageCursor } from "../../../services/tenant/ai/usage/aiUsageCursor.js";

function toNumber(value: string | number | null): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export class AiInteractionLogRepository {
  constructor(private readonly database: Database = db) {}

  async create(
    input: AiInteractionLogCreateInput
  ): Promise<AiInteractionLogRow | undefined> {
    const [created] = await this.database
      .insert(aiInteractionLogs)
      .values({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        contactId: input.contactId ?? null,
        operatorId: input.operatorId ?? null,
        stage: input.stage,
        action: input.action,
        riskLevel: input.riskLevel,
        riskReasons: input.riskReasons,
        matchedRules: input.matchedRules,
        blocked: input.blocked,
        source: input.source ?? null,
        provider: input.provider ?? null,
        promptVersion: input.promptVersion ?? null,
        inputCharCount: input.inputCharCount,
        outputCharCount: input.outputCharCount ?? null,
        model: input.model ?? null,
        promptTokens: input.promptTokens ?? null,
        cachedPromptTokens: input.cachedPromptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        durationMs: input.durationMs ?? null,
        contextItemsCount: input.contextItemsCount ?? null,
        contextChars: input.contextChars ?? null,
      })
      .returning();

    return created;
  }

  async countRecentHighRisk(input: AiRecentHighRiskCountInput): Promise<number> {
    const [result] = await this.database
      .select({ value: count() })
      .from(aiInteractionLogs)
      .where(
        and(
          eq(aiInteractionLogs.tenantId, input.tenantId),
          eq(aiInteractionLogs.conversationId, input.conversationId),
          gte(aiInteractionLogs.createdAt, input.since),
          eq(aiInteractionLogs.riskLevel, "high"),
          eq(aiInteractionLogs.blocked, true)
        )
      );

    return result?.value ?? 0;
  }

  private usageWhere(filter: AiUsageFilter): SQL | undefined {
    const conditions = [
      eq(aiInteractionLogs.tenantId, filter.tenantId),
      gte(aiInteractionLogs.createdAt, filter.from),
      lt(aiInteractionLogs.createdAt, filter.to),
    ];
    if (filter.conversationId) {
      conditions.push(eq(aiInteractionLogs.conversationId, filter.conversationId));
    }
    if (filter.model) {
      conditions.push(eq(aiInteractionLogs.model, filter.model));
    }
    if (filter.source) {
      conditions.push(eq(aiInteractionLogs.source, filter.source));
    }
    if (filter.provider) {
      conditions.push(eq(aiInteractionLogs.provider, filter.provider));
    }
    if (filter.riskLevel) {
      conditions.push(eq(aiInteractionLogs.riskLevel, filter.riskLevel));
    }
    if (filter.blocked != null) {
      conditions.push(eq(aiInteractionLogs.blocked, filter.blocked));
    }
    if (filter.stage) {
      conditions.push(eq(aiInteractionLogs.stage, filter.stage));
    }
    return and(...conditions);
  }

  private usageCursorWhere(cursor: AiUsageRecentCursor | null): SQL | undefined {
    if (!cursor) return undefined;

    return or(
      lt(aiInteractionLogs.createdAt, cursor.createdAt),
      and(
        eq(aiInteractionLogs.createdAt, cursor.createdAt),
        lt(aiInteractionLogs.id, cursor.id)
      )
    );
  }

  /** Agregados de uso (tenant-scoped, janela [from, to)). Tokens null contam 0. */
  async getUsageSummary(filter: AiUsageFilter): Promise<AiUsageSummaryRaw> {
    const [row] = await this.database
      .select({
        totalInteractions: count(),
        blockedInteractions: count(
          sql`case when ${aiInteractionLogs.blocked} then 1 end`
        ),
        promptTokens: sum(aiInteractionLogs.promptTokens),
        cachedPromptTokens: sum(aiInteractionLogs.cachedPromptTokens),
        completionTokens: sum(aiInteractionLogs.completionTokens),
        totalTokens: sum(aiInteractionLogs.totalTokens),
        avgDurationMs: avg(aiInteractionLogs.durationMs),
      })
      .from(aiInteractionLogs)
      .where(this.usageWhere(filter));

    return {
      totalInteractions: toNumber(row?.totalInteractions ?? 0),
      blockedInteractions: toNumber(row?.blockedInteractions ?? 0),
      promptTokens: toNumber(row?.promptTokens ?? 0),
      cachedPromptTokens: toNumber(row?.cachedPromptTokens ?? 0),
      completionTokens: toNumber(row?.completionTokens ?? 0),
      totalTokens: toNumber(row?.totalTokens ?? 0),
      avgDurationMs:
        row?.avgDurationMs == null ? null : toNumber(row.avgDurationMs),
    };
  }

  /** Uso agrupado por modelo (inclui linha de `model = null`). */
  async getUsageByModel(filter: AiUsageFilter): Promise<AiUsageByModelRaw[]> {
    const rows = await this.database
      .select({
        model: aiInteractionLogs.model,
        interactions: count(),
        promptTokens: sum(aiInteractionLogs.promptTokens),
        cachedPromptTokens: sum(aiInteractionLogs.cachedPromptTokens),
        completionTokens: sum(aiInteractionLogs.completionTokens),
        totalTokens: sum(aiInteractionLogs.totalTokens),
      })
      .from(aiInteractionLogs)
      .where(this.usageWhere(filter))
      .groupBy(aiInteractionLogs.model);

    return rows.map((r) => ({
      model: r.model,
      interactions: toNumber(r.interactions),
      promptTokens: toNumber(r.promptTokens),
      cachedPromptTokens: toNumber(r.cachedPromptTokens),
      completionTokens: toNumber(r.completionTokens),
      totalTokens: toNumber(r.totalTokens),
    }));
  }

  /** Últimas N interações — APENAS campos seguros (sem prompt/mensagem/reasons). */
  async listRecentUsage(
    filter: AiUsageFilter,
    limit: number,
    cursor: AiUsageRecentCursor | null = null
  ): Promise<AiUsageRecentRowsPage> {
    const rows = await this.database
      .select({
        id: aiInteractionLogs.id,
        createdAt: aiInteractionLogs.createdAt,
        conversationId: aiInteractionLogs.conversationId,
        stage: aiInteractionLogs.stage,
        model: aiInteractionLogs.model,
        source: aiInteractionLogs.source,
        provider: aiInteractionLogs.provider,
        riskLevel: aiInteractionLogs.riskLevel,
        blocked: aiInteractionLogs.blocked,
        promptTokens: aiInteractionLogs.promptTokens,
        cachedPromptTokens: aiInteractionLogs.cachedPromptTokens,
        completionTokens: aiInteractionLogs.completionTokens,
        totalTokens: aiInteractionLogs.totalTokens,
        durationMs: aiInteractionLogs.durationMs,
      })
      .from(aiInteractionLogs)
      .where(and(this.usageWhere(filter), this.usageCursorWhere(cursor)))
      .orderBy(desc(aiInteractionLogs.createdAt), desc(aiInteractionLogs.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit) as AiUsageRecentRow[];
    const last = items.at(-1);

    return {
      items,
      hasNextPage,
      nextCursor:
        hasNextPage && last
          ? encodeAiUsageCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
}
