import { describe, expect, it, vi } from "vitest";
import { AiInteractionLogService } from "./AiInteractionLogService.js";
import type { AiInteractionLogCreateInput } from "../../../../types/tenant/ai/AiInteractionTypes.js";

type SensitiveKeys =
  | "inputText"
  | "outputText"
  | "rawPrompt"
  | "rawCompletion"
  | "messages";

type HasSensitiveKeys = Extract<keyof AiInteractionLogCreateInput, SensitiveKeys>;
const hasNoSensitiveFields: HasSensitiveKeys extends never ? true : never = true;

const baseInput: AiInteractionLogCreateInput = {
  tenantId: "tenant-1",
  conversationId: "conversation-1",
  contactId: "contact-1",
  operatorId: "operator-1",
  stage: "input",
  action: "block",
  riskLevel: "high",
  riskReasons: ["policy_bypass", "policy_bypass"],
  matchedRules: ["policy.bypass", "policy.bypass"],
  blocked: true,
  source: "openai",
  promptVersion: "v1",
  inputCharCount: 120,
  outputCharCount: 12,
  model: "gpt-test",
};

describe("AiInteractionLogService", () => {
  it("normaliza e persiste o payload do log", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(undefined),
      countRecentHighRisk: vi.fn(),
    };
    const service = new AiInteractionLogService(repository);

    await service.record({
      ...baseInput,
      riskReasons: [" policy_bypass ", "policy_bypass", ""],
      matchedRules: [" policy.bypass ", "policy.bypass", ""],
    });

    expect(repository.create).toHaveBeenCalledWith({
      ...baseInput,
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
    });
  });

  it("faz clamp de contadores negativos para zero", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(undefined),
      countRecentHighRisk: vi.fn(),
    };
    const service = new AiInteractionLogService(repository);

    await service.record({
      ...baseInput,
      inputCharCount: -15,
      outputCharCount: -8,
    });

    expect(repository.create).toHaveBeenCalledWith({
      ...baseInput,
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
      inputCharCount: 0,
      outputCharCount: 0,
    });
  });

  it("mantem outputCharCount nulo quando ausente", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(undefined),
      countRecentHighRisk: vi.fn(),
    };
    const service = new AiInteractionLogService(repository);

    await service.record({
      ...baseInput,
      outputCharCount: null,
    });

    expect(repository.create).toHaveBeenCalledWith({
      ...baseInput,
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
      outputCharCount: null,
    });
  });

  it("delegates countRecentHighRisk com os filtros recebidos", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue(undefined),
      countRecentHighRisk: vi.fn().mockResolvedValue(3),
    };
    const service = new AiInteractionLogService(repository);
    const since = new Date("2026-06-14T12:00:00.000Z");

    await expect(
      service.countRecentHighRisk({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        since,
      })
    ).resolves.toBe(3);

    expect(repository.countRecentHighRisk).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      since,
    });
  });

  it("não derruba a sugestão quando a tabela ai_interaction_logs ainda não existe ao gravar", async () => {
    const repository = {
      create: vi.fn().mockRejectedValue({
        code: "42P01",
        message: 'relation "ai_interaction_logs" does not exist',
      }),
      countRecentHighRisk: vi.fn(),
    };
    const service = new AiInteractionLogService(repository);

    await expect(service.record(baseInput)).resolves.toBeUndefined();
  });

  it("retorna zero quando a tabela ai_interaction_logs ainda não existe ao contar abuso recente", async () => {
    const repository = {
      create: vi.fn(),
      countRecentHighRisk: vi.fn().mockRejectedValue({
        code: "42P01",
        message: 'relation "ai_interaction_logs" does not exist',
      }),
    };
    const service = new AiInteractionLogService(repository);
    const since = new Date("2026-06-14T12:00:00.000Z");

    await expect(
      service.countRecentHighRisk({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        since,
      })
    ).resolves.toBe(0);
  });

  it("mantem o contrato sem campos sensiveis no input tipado", () => {
    expect(hasNoSensitiveFields).toBe(true);
  });
});
