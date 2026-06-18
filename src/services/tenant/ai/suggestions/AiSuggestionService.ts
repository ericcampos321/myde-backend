import type { Logger } from "pino";
import { createLogger } from "../../../../shared/logger/logger.js";
import { LogEvents } from "../../../../shared/logger/events.js";
import {
  AiSafetyGuardService,
} from "../guardrails/AiSafetyGuardService.js";
import {
  AiInteractionLogService,
} from "../interactions/AiInteractionLogService.js";
import { GUARDRAIL_BLOCKED_RESPONSE } from "../guardrails/AiGuardrailResponses.js";
import {
  buildAiSystemPrompt,
  type AiSystemPromptResult,
} from "../prompts/index.js";
import {
  createAiResponseService,
  type AiResponseService,
} from "../AiResponseService.js";
import type { AiResponseConversationMessage, AiResponseResult } from "../../../../types/tenant/ai/AiTypes.js";
import type {
  AiSuggestionResult,
  AiSuggestionServiceInput,
} from "../../../../types/tenant/ai/AiSuggestionTypes.js";
import type {
  AiRiskAction,
  AiRiskLevel,
  AiRiskReason,
  AiSafetyDecision,
} from "../../../../types/tenant/ai/AiGuardrailTypes.js";
import type { AiInteractionStage } from "../../../../types/tenant/ai/AiInteractionTypes.js";

export const AI_SUGGESTION_BLOCKED_USER_MESSAGE =
  GUARDRAIL_BLOCKED_RESPONSE;

export const AI_SUGGESTION_OUTPUT_BLOCKED_USER_MESSAGE =
  "A sugestão gerada foi bloqueada por segurança. Revise manualmente antes de responder.";

const DEFAULT_RECENT_HIGH_RISK_WINDOW_MINUTES = 10;

interface AiResponseExecutionResult extends AiResponseResult {
  model?: string | null;
}

interface AiResponseExecutionService {
  generateResponse(input: {
    currentMessage: string;
    conversationHistory: AiResponseConversationMessage[];
  }): Promise<AiResponseExecutionResult>;
}

export interface AiSuggestionServiceDependencies {
  safetyGuard?: Pick<AiSafetyGuardService, "analyzeInput" | "validateOutput">;
  interactionLogService?: Pick<
    AiInteractionLogService,
    "countRecentHighRisk" | "record"
  >;
  promptBuilder?: (input?: { reinforced?: boolean }) => AiSystemPromptResult;
  aiResponseServiceFactory?: (input: {
    systemPrompt: string;
  }) => AiResponseExecutionService;
  now?: () => Date;
  log?: Logger;
}

export class AiSuggestionService {
  private readonly safetyGuard: Pick<
    AiSafetyGuardService,
    "analyzeInput" | "validateOutput"
  >;
  private readonly interactionLogService: Pick<
    AiInteractionLogService,
    "countRecentHighRisk" | "record"
  >;
  private readonly promptBuilder: (
    input?: { reinforced?: boolean }
  ) => AiSystemPromptResult;
  private readonly aiResponseServiceFactory: (input: {
    systemPrompt: string;
  }) => AiResponseExecutionService;
  private readonly now: () => Date;
  private readonly log: Logger;

  constructor(dependencies: AiSuggestionServiceDependencies) {
    this.safetyGuard = dependencies.safetyGuard ?? new AiSafetyGuardService();
    this.interactionLogService =
      dependencies.interactionLogService ?? new AiInteractionLogService();
    this.promptBuilder = dependencies.promptBuilder ?? buildAiSystemPrompt;
    this.aiResponseServiceFactory =
      dependencies.aiResponseServiceFactory ?? createSuggestionAiResponseService;
    this.now = dependencies.now ?? (() => new Date());
    this.log = dependencies.log ?? createLogger({ module: "ai-suggestion" });
  }

  async suggest(input: AiSuggestionServiceInput): Promise<AiSuggestionResult> {
    const now = this.now();
    const startedAt = Date.now();
    // Correlação por domínio (sem texto/prompt). requestId fica no log HTTP da rota.
    const correlation = {
      correlationId: input.conversationId,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    };
    this.log.info(
      { event: LogEvents.ai.suggestionStarted, ...correlation },
      "ai suggestion started"
    );
    const windowMinutes =
      input.recentHighRiskWindowMinutes ?? DEFAULT_RECENT_HIGH_RISK_WINDOW_MINUTES;
    const since = new Date(now.getTime() - windowMinutes * 60_000);

    const recentHighRiskCount =
      await this.interactionLogService.countRecentHighRisk({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        since,
      });

    const inputDecision = this.safetyGuard.analyzeInput({
      text: input.userMessage,
      recentHighRiskCount,
    });

    if (inputDecision.action === "block") {
      await this.interactionLogService.record({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        contactId: input.contactId ?? null,
        operatorId: input.operatorId ?? null,
        stage: resolveBlockedInputStage(inputDecision),
        action: inputDecision.action,
        riskLevel: inputDecision.riskLevel,
        riskReasons: inputDecision.riskReasons,
        matchedRules: inputDecision.matchedRules,
        blocked: true,
        source: null,
        promptVersion: null,
        inputCharCount: input.userMessage.length,
        outputCharCount: AI_SUGGESTION_BLOCKED_USER_MESSAGE.length,
        model: null,
      });

      this.log.warn(
        {
          event: LogEvents.ai.suggestionBlocked,
          ...correlation,
          stage: "input",
          riskLevel: inputDecision.riskLevel,
          riskReasons: inputDecision.riskReasons,
          durationMs: Date.now() - startedAt,
        },
        "ai suggestion blocked"
      );

      return {
        suggestion: null,
        source: null,
        blocked: true,
        riskLevel: inputDecision.riskLevel,
        riskReasons: inputDecision.riskReasons,
        userMessage: AI_SUGGESTION_BLOCKED_USER_MESSAGE,
      };
    }

    const prompt = this.promptBuilder({
      reinforced: inputDecision.action === "flag",
    });
    const aiResponseService = this.aiResponseServiceFactory({
      systemPrompt: prompt.systemPrompt,
    });
    const result = await aiResponseService.generateResponse({
      currentMessage: input.userMessage,
      conversationHistory: mapHistoryToAiResponse(input.history),
    });

    const outputDecision = this.safetyGuard.validateOutput({
      text: result.text,
    });

    if (outputDecision.action === "block") {
      await this.interactionLogService.record({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        contactId: input.contactId ?? null,
        operatorId: input.operatorId ?? null,
        stage: "output",
        action: outputDecision.action,
        riskLevel: outputDecision.riskLevel,
        riskReasons: outputDecision.riskReasons,
        matchedRules: outputDecision.matchedRules,
        blocked: true,
        source: result.source,
        promptVersion: prompt.version,
        provider: result.source,
        inputCharCount: input.userMessage.length,
        outputCharCount: result.text.length,
        model: result.model ?? null,
        promptTokens: result.usage?.promptTokens ?? null,
        ...(result.usage?.cachedPromptTokens != null
          ? { cachedPromptTokens: result.usage.cachedPromptTokens }
          : {}),
        completionTokens: result.usage?.completionTokens ?? null,
        totalTokens: result.usage?.totalTokens ?? null,
        durationMs: Date.now() - startedAt,
        contextItemsCount: result.contextItemsCount ?? null,
        contextChars: result.contextChars ?? null,
      });

      this.log.warn(
        {
          event: LogEvents.ai.suggestionBlocked,
          ...correlation,
          stage: "output",
          riskLevel: outputDecision.riskLevel,
          riskReasons: outputDecision.riskReasons,
          durationMs: Date.now() - startedAt,
        },
        "ai suggestion output blocked"
      );

      return {
        suggestion: null,
        source: result.source,
        blocked: true,
        riskLevel: outputDecision.riskLevel,
        riskReasons: outputDecision.riskReasons,
        userMessage: AI_SUGGESTION_OUTPUT_BLOCKED_USER_MESSAGE,
      };
    }

    await this.interactionLogService.record({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      contactId: input.contactId ?? null,
      operatorId: input.operatorId ?? null,
      stage: "input",
      action: normalizeLogAction(inputDecision.riskLevel),
      riskLevel: inputDecision.riskLevel,
      riskReasons: inputDecision.riskReasons,
      matchedRules: inputDecision.matchedRules,
      blocked: false,
      source: result.source,
      promptVersion: prompt.version,
      provider: result.source,
      inputCharCount: input.userMessage.length,
      outputCharCount: result.text.length,
      model: result.model ?? null,
      promptTokens: result.usage?.promptTokens ?? null,
      ...(result.usage?.cachedPromptTokens != null
        ? { cachedPromptTokens: result.usage.cachedPromptTokens }
        : {}),
      completionTokens: result.usage?.completionTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
      durationMs: Date.now() - startedAt,
      contextItemsCount: result.contextItemsCount ?? null,
      contextChars: result.contextChars ?? null,
    });

    this.log.info(
      {
        event: LogEvents.ai.suggestionCompleted,
        ...correlation,
        source: result.source,
        riskLevel: inputDecision.riskLevel,
        durationMs: Date.now() - startedAt,
      },
      "ai suggestion completed"
    );

    return {
      suggestion: result.text,
      source: result.source,
      blocked: false,
      riskLevel: inputDecision.riskLevel,
      riskReasons: inputDecision.riskReasons,
      userMessage: null,
    };
  }
}

function createSuggestionAiResponseService(input: {
  systemPrompt: string;
}): AiResponseExecutionService {
  const service: AiResponseService = createAiResponseService({
    systemPrompt: input.systemPrompt,
  });

  return {
    async generateResponse(payload) {
      // Repassa model/usage/contexto vindos do AiResponseService (controle de custo).
      return service.generateResponse(payload);
    },
  };
}

function resolveBlockedInputStage(decision: AiSafetyDecision): AiInteractionStage {
  return decision.riskReasons.includes("recurring_abuse") ? "recurring" : "input";
}

function normalizeLogAction(riskLevel: AiRiskLevel): AiRiskAction {
  return riskLevel === "medium" ? "flag" : "allow";
}

function mapHistoryToAiResponse(
  history: AiSuggestionServiceInput["history"]
): AiResponseConversationMessage[] {
  return history.map((item) => ({
    direction: item.role === "user" ? "inbound" : "outbound",
    body: item.content,
  }));
}
