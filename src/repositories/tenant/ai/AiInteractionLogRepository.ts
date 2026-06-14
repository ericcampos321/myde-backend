import { and, count, eq, gte } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import {
  aiInteractionLogs,
  type AiInteractionLogRow,
} from "../../../db/schema/index.js";
import type {
  AiInteractionLogCreateInput,
  AiRecentHighRiskCountInput,
} from "../../../types/tenant/ai/AiInteractionTypes.js";

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
        promptVersion: input.promptVersion ?? null,
        inputCharCount: input.inputCharCount,
        outputCharCount: input.outputCharCount ?? null,
        model: input.model ?? null,
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
}
