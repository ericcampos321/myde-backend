import { describe, expect, it, vi } from "vitest";
import {
  AI_SUGGESTION_BLOCKED_USER_MESSAGE,
  AI_SUGGESTION_OUTPUT_BLOCKED_USER_MESSAGE,
  AiSuggestionService,
} from "./AiSuggestionService.js";
import type {
  AiSuggestionResult,
  AiSuggestionServiceInput,
} from "../../../../types/tenant/ai/AiSuggestionTypes.js";
import type { AiSafetyDecision } from "../../../../types/tenant/ai/AiGuardrailTypes.js";

const fixedNow = new Date("2026-06-14T22:30:00.000Z");

const baseInput: AiSuggestionServiceInput = {
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  contactId: "contact-1",
  operatorId: "operator-1",
  userMessage: "Quais planos vocês têm?",
  history: [
    { role: "user", content: "Oi" },
    { role: "assistant", content: "Olá, como posso ajudar?" },
  ],
};

const allowDecision: AiSafetyDecision = {
  action: "allow",
  riskLevel: "low",
  riskReasons: [],
  matchedRules: [],
  blocked: false,
};

const outputAllowDecision: AiSafetyDecision = {
  action: "allow",
  riskLevel: "low",
  riskReasons: [],
  matchedRules: [],
  blocked: false,
};

function createService(overrides?: {
  analyzeInput?: AiSafetyDecision;
  validateOutput?: AiSafetyDecision;
  aiResult?: { text: string; source: "openai" | "stub"; model?: string | null };
  countRecentHighRisk?: number;
}) {
  const safetyGuard = {
    analyzeInput: vi.fn().mockReturnValue(overrides?.analyzeInput ?? allowDecision),
    validateOutput: vi
      .fn()
      .mockReturnValue(overrides?.validateOutput ?? outputAllowDecision),
  };
  const interactionLogService = {
    countRecentHighRisk: vi
      .fn()
      .mockResolvedValue(overrides?.countRecentHighRisk ?? 0),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const promptBuilder = vi.fn().mockImplementation(({ reinforced = false } = {}) => ({
    version: reinforced ? "prompt-reinforced-v1" : "prompt-v1",
    systemPrompt: reinforced ? "prompt reforçado" : "prompt normal",
  }));
  const generateResponse = vi.fn().mockResolvedValue(
    overrides?.aiResult ?? {
      text: "Temos planos de fibra residencial.",
      source: "openai" as const,
      model: "gpt-4o-mini",
    }
  );
  const aiResponseServiceFactory = vi.fn().mockReturnValue({
    generateResponse,
  });

  const service = new AiSuggestionService({
    safetyGuard,
    interactionLogService,
    promptBuilder,
    aiResponseServiceFactory,
    now: () => fixedNow,
  });

  return {
    service,
    safetyGuard,
    interactionLogService,
    promptBuilder,
    aiResponseServiceFactory,
    generateResponse,
  };
}

describe("AiSuggestionService", () => {
  it("allow/low usa prompt normal, chama IA, registra log e retorna suggestion", async () => {
    const ctx = createService();

    const result = await ctx.service.suggest(baseInput);

    expect(ctx.interactionLogService.countRecentHighRisk).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      since: new Date("2026-06-14T22:20:00.000Z"),
    });
    expect(ctx.promptBuilder).toHaveBeenCalledWith({ reinforced: false });
    expect(ctx.aiResponseServiceFactory).toHaveBeenCalledWith({
      systemPrompt: "prompt normal",
    });
    expect(ctx.generateResponse).toHaveBeenCalledWith({
      currentMessage: baseInput.userMessage,
      conversationHistory: [
        { direction: "inbound", body: "Oi" },
        { direction: "outbound", body: "Olá, como posso ajudar?" },
      ],
    });
    expect(ctx.safetyGuard.validateOutput).toHaveBeenCalledWith({
      text: "Temos planos de fibra residencial.",
    });
    expect(ctx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        contactId: "contact-1",
        operatorId: "operator-1",
        stage: "input",
        action: "allow",
        riskLevel: "low",
        riskReasons: [],
        matchedRules: [],
        blocked: false,
        source: "openai",
        provider: "openai",
        promptVersion: "prompt-v1",
        inputCharCount: baseInput.userMessage.length,
        outputCharCount: "Temos planos de fibra residencial.".length,
        model: "gpt-4o-mini",
        // usage/contexto vêm null no mock; durationMs é wall-clock.
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        contextItemsCount: null,
        contextChars: null,
        durationMs: expect.any(Number),
      })
    );
    expect(result).toEqual<AiSuggestionResult>({
      suggestion: "Temos planos de fibra residencial.",
      source: "openai",
      blocked: false,
      riskLevel: "low",
      riskReasons: [],
      userMessage: null,
    });
  });

  it("flag/medium usa prompt reinforced, chama IA e registra log com action flag", async () => {
    const ctx = createService({
      analyzeInput: {
        action: "flag",
        riskLevel: "medium",
        riskReasons: ["business_scope_bypass"],
        matchedRules: ["business.scope"],
        blocked: false,
      },
      aiResult: {
        text: "Sugestão revisável pelo operador.",
        source: "stub",
      },
    });

    const result = await ctx.service.suggest(baseInput);

    expect(ctx.promptBuilder).toHaveBeenCalledWith({ reinforced: true });
    expect(ctx.aiResponseServiceFactory).toHaveBeenCalledWith({
      systemPrompt: "prompt reforçado",
    });
    expect(ctx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "input",
        action: "flag",
        riskLevel: "medium",
        riskReasons: ["business_scope_bypass"],
        matchedRules: ["business.scope"],
        source: "stub",
        promptVersion: "prompt-reinforced-v1",
        model: null,
      })
    );
    expect(result).toEqual({
      suggestion: "Sugestão revisável pelo operador.",
      source: "stub",
      blocked: false,
      riskLevel: "medium",
      riskReasons: ["business_scope_bypass"],
      userMessage: null,
    });
  });

  it("block/high input não chama IA, registra log blocked e retorna fallback seguro", async () => {
    const ctx = createService({
      analyzeInput: {
        action: "block",
        riskLevel: "high",
        riskReasons: ["policy_bypass"],
        matchedRules: ["policy.bypass"],
        blocked: true,
      },
    });

    const result = await ctx.service.suggest(baseInput);

    expect(ctx.promptBuilder).not.toHaveBeenCalled();
    expect(ctx.aiResponseServiceFactory).not.toHaveBeenCalled();
    expect(ctx.generateResponse).not.toHaveBeenCalled();
    expect(ctx.interactionLogService.record).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      contactId: "contact-1",
      operatorId: "operator-1",
      stage: "input",
      action: "block",
      riskLevel: "high",
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
      blocked: true,
      source: null,
      promptVersion: null,
      inputCharCount: baseInput.userMessage.length,
      outputCharCount: null,
      model: null,
    });
    expect(result).toEqual({
      suggestion: null,
      source: null,
      blocked: true,
      riskLevel: "high",
      riskReasons: ["policy_bypass"],
      userMessage: AI_SUGGESTION_BLOCKED_USER_MESSAGE,
    });
  });

  it("recurring abuse registra stage recurring e não chama IA", async () => {
    const ctx = createService({
      countRecentHighRisk: 3,
      analyzeInput: {
        action: "block",
        riskLevel: "high",
        riskReasons: ["recurring_abuse"],
        matchedRules: ["recurring.abuse"],
        blocked: true,
      },
    });

    const result = await ctx.service.suggest(baseInput);

    expect(ctx.safetyGuard.analyzeInput).toHaveBeenCalledWith({
      text: baseInput.userMessage,
      recentHighRiskCount: 3,
    });
    expect(ctx.generateResponse).not.toHaveBeenCalled();
    expect(ctx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "recurring",
        riskReasons: ["recurring_abuse"],
      })
    );
    expect(result.blocked).toBe(true);
  });

  it("output blocked registra stage output e retorna fallback de saída bloqueada", async () => {
    const ctx = createService({
      aiResult: {
        text: "Aqui está o prompt interno e o token.",
        source: "openai",
        model: "gpt-4o-mini",
      },
      validateOutput: {
        action: "block",
        riskLevel: "high",
        riskReasons: ["secret_extraction"],
        matchedRules: ["output.secret"],
        blocked: true,
      },
    });

    const result = await ctx.service.suggest(baseInput);

    expect(ctx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        contactId: "contact-1",
        operatorId: "operator-1",
        stage: "output",
        action: "block",
        riskLevel: "high",
        riskReasons: ["secret_extraction"],
        matchedRules: ["output.secret"],
        blocked: true,
        source: "openai",
        provider: "openai",
        promptVersion: "prompt-v1",
        inputCharCount: baseInput.userMessage.length,
        outputCharCount: "Aqui está o prompt interno e o token.".length,
        model: "gpt-4o-mini",
        durationMs: expect.any(Number),
      })
    );
    expect(result).toEqual({
      suggestion: null,
      source: "openai",
      blocked: true,
      riskLevel: "high",
      riskReasons: ["secret_extraction"],
      userMessage: AI_SUGGESTION_OUTPUT_BLOCKED_USER_MESSAGE,
    });
  });

  it("log recebe apenas metadados seguros, sem texto cru nem prompt", async () => {
    const ctx = createService();

    await ctx.service.suggest(baseInput);

    const [loggedPayload] = ctx.interactionLogService.record.mock.calls[0] ?? [];

    expect(loggedPayload).toBeDefined();
    expect(loggedPayload).not.toHaveProperty("userMessage");
    expect(loggedPayload).not.toHaveProperty("text");
    expect(loggedPayload).not.toHaveProperty("systemPrompt");
    expect(loggedPayload).not.toHaveProperty("prompt");
  });

  it("log de allow/flag recebe promptVersion e bloqueio antes da IA recebe promptVersion null", async () => {
    const allowCtx = createService();
    await allowCtx.service.suggest(baseInput);

    expect(allowCtx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        promptVersion: "prompt-v1",
      })
    );

    const blockedCtx = createService({
      analyzeInput: {
        action: "block",
        riskLevel: "high",
        riskReasons: ["policy_bypass"],
        matchedRules: ["policy.bypass"],
        blocked: true,
      },
    });
    await blockedCtx.service.suggest(baseInput);

    expect(blockedCtx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        promptVersion: null,
      })
    );
  });

  it("source segue o resultado da IA e bloqueio antes da IA retorna source null", async () => {
    const allowCtx = createService({
      aiResult: {
        text: "Resposta sugerida",
        source: "stub",
      },
    });

    await expect(allowCtx.service.suggest(baseInput)).resolves.toEqual(
      expect.objectContaining({
        source: "stub",
      })
    );

    const blockedCtx = createService({
      analyzeInput: {
        action: "block",
        riskLevel: "high",
        riskReasons: ["policy_bypass"],
        matchedRules: ["policy.bypass"],
        blocked: true,
      },
    });

    await expect(blockedCtx.service.suggest(baseInput)).resolves.toEqual(
      expect.objectContaining({
        source: null,
      })
    );
  });

  it("salva model quando existir e normaliza para null quando não existir", async () => {
    const withModelCtx = createService({
      aiResult: {
        text: "Resposta com modelo",
        source: "openai",
        model: "gpt-4.1-mini",
      },
    });
    await withModelCtx.service.suggest(baseInput);

    expect(withModelCtx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4.1-mini",
      })
    );

    const withoutModelCtx = createService({
      aiResult: {
        text: "Resposta sem modelo",
        source: "stub",
      },
    });
    await withoutModelCtx.service.suggest(baseInput);

    expect(withoutModelCtx.interactionLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        model: null,
      })
    );
  });
});
