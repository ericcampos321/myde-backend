import type {
  AiInteractionLogCreateInput,
  AiRecentHighRiskCountInput,
} from "../../../../types/tenant/ai/AiInteractionTypes.js";
import { AiInteractionLogRepository } from "../../../../repositories/tenant/ai/index.js";

type AiInteractionLogRepositoryContract = Pick<
  AiInteractionLogRepository,
  "create" | "countRecentHighRisk"
>;

export class AiInteractionLogService {
  constructor(
    private readonly repository: AiInteractionLogRepositoryContract = new AiInteractionLogRepository()
  ) {}

  async record(input: AiInteractionLogCreateInput): Promise<void> {
    try {
      await this.repository.create(normalizeLogInput(input));
    } catch (error) {
      if (isMissingAiInteractionLogsTableError(error)) {
        return;
      }

      throw error;
    }
  }

  async countRecentHighRisk(input: AiRecentHighRiskCountInput): Promise<number> {
    try {
      return await this.repository.countRecentHighRisk(input);
    } catch (error) {
      if (isMissingAiInteractionLogsTableError(error)) {
        return 0;
      }

      throw error;
    }
  }
}

function normalizeLogInput(
  input: AiInteractionLogCreateInput
): AiInteractionLogCreateInput {
  return {
    ...input,
    riskReasons: uniqueTrimmed(input.riskReasons),
    matchedRules: uniqueTrimmed(input.matchedRules),
    inputCharCount: clampCount(input.inputCharCount),
    outputCharCount:
      input.outputCharCount == null ? null : clampCount(input.outputCharCount),
  };
}

function uniqueTrimmed<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.map((value) => value.trim() as T).filter(Boolean))];
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function isMissingAiInteractionLogsTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;

  return (
    code === "42P01" &&
    typeof message === "string" &&
    message.includes('relation "ai_interaction_logs" does not exist')
  );
}
