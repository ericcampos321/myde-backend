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
    await this.repository.create(normalizeLogInput(input));
  }

  async countRecentHighRisk(input: AiRecentHighRiskCountInput): Promise<number> {
    return this.repository.countRecentHighRisk(input);
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
