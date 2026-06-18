import { describe, it, expect, vi } from "vitest";
import { AiUsageService } from "./AiUsageService.js";
import type { AiUsageFilter } from "../../../../types/tenant/ai/AiUsageTypes.js";

const filter: AiUsageFilter = {
  tenantId: "tenant-1",
  from: new Date("2026-06-07T00:00:00.000Z"),
  to: new Date("2026-06-14T00:00:00.000Z"),
};

function buildRepo(overrides: {
  summary?: Partial<ReturnType<typeof defaultSummary>>;
  byModel?: unknown[];
  recent?: unknown[];
  nextCursor?: string | null;
  hasNextPage?: boolean;
}) {
  return {
    getUsageSummary: vi
      .fn()
      .mockResolvedValue({ ...defaultSummary(), ...overrides.summary }),
    getUsageByModel: vi.fn().mockResolvedValue(overrides.byModel ?? []),
    listRecentUsage: vi.fn().mockResolvedValue({
      items: overrides.recent ?? [],
      nextCursor: overrides.nextCursor ?? null,
      hasNextPage: overrides.hasNextPage ?? false,
    }),
  };
}

function defaultSummary() {
  return {
    totalInteractions: 0,
    blockedInteractions: 0,
    promptTokens: 0,
    cachedPromptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    avgDurationMs: null as number | null,
  };
}

describe("AiUsageService.getUsage", () => {
  it("monta summary (completed = total - blocked) e arredonda avgDuration", async () => {
    const repo = buildRepo({
      summary: {
        totalInteractions: 10,
        blockedInteractions: 3,
        promptTokens: 1200,
        completionTokens: 800,
        totalTokens: 2000,
        avgDurationMs: 1234.6,
      },
    });
    const service = new AiUsageService(repo as never);

    const result = await service.getUsage(filter, 20);

    expect(result.summary.totalInteractions).toBe(10);
    expect(result.summary.blockedInteractions).toBe(3);
    expect(result.summary.completedInteractions).toBe(7);
    expect(result.summary.totalTokens).toBe(2000);
    expect(result.summary.avgDurationMs).toBe(1235);
  });

  it("byModel calcula estimatedCost por modelo e soma no summary", async () => {
    const repo = buildRepo({
      summary: { totalInteractions: 2, totalTokens: 2000 },
      byModel: [
        {
          model: "gpt-4o-mini",
          interactions: 1,
          promptTokens: 1000,
          cachedPromptTokens: 0,
          completionTokens: 1000,
          totalTokens: 2000,
        },
      ],
    });
    const service = new AiUsageService(repo as never);

    const result = await service.getUsage(filter, 20);

    expect(result.byModel[0]!.estimatedCost).toBe(0.00075);
    expect(result.summary.estimatedCost).toBe(0.00075);
  });

  it("usa cachedPromptTokens no custo por modelo quando disponível", async () => {
    const repo = buildRepo({
      byModel: [
        {
          model: "gpt-5.4",
          interactions: 1,
          promptTokens: 1000,
          cachedPromptTokens: 200,
          completionTokens: 1000,
          totalTokens: 2000,
        },
      ],
    });
    const service = new AiUsageService(repo as never);

    const result = await service.getUsage(filter, 20);

    expect(result.byModel[0]!.estimatedCost).toBe(0.01705);
    expect(result.summary.estimatedCost).toBe(0.01705);
  });

  it("estimatedCost null quando nenhum modelo tem preço", async () => {
    const repo = buildRepo({
      byModel: [
        {
          model: "modelo-inexistente",
          interactions: 1,
          promptTokens: 1000,
          cachedPromptTokens: 0,
          completionTokens: 1000,
          totalTokens: 2000,
        },
        {
          model: null,
          interactions: 1,
          promptTokens: 0,
          cachedPromptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      ],
    });
    const service = new AiUsageService(repo as never);

    const result = await service.getUsage(filter, 20);
    expect(result.byModel.every((m) => m.estimatedCost === null)).toBe(true);
    expect(result.summary.estimatedCost).toBeNull();
  });

  it("recent só expõe campos seguros (sem prompt/mensagem/reasons)", async () => {
    const repo = buildRepo({
      recent: [
        {
          id: "log-1",
          createdAt: new Date("2026-06-13T10:00:00.000Z"),
          conversationId: "conv-1",
          stage: "auto_reply",
          model: "gpt-4o-mini",
          source: "openai",
          provider: "openai",
          riskLevel: "low",
          blocked: false,
          promptTokens: 1000,
          cachedPromptTokens: 0,
          completionTokens: 1000,
          totalTokens: 1500,
          durationMs: 900,
        },
      ],
    });
    const service = new AiUsageService(repo as never);

    const result = await service.getUsage(filter, 20);
    const item = result.recent.items[0]!;

    expect(item.createdAt).toBe("2026-06-13T10:00:00.000Z");
    expect(Object.keys(item).sort()).toEqual(
      [
        "blocked",
        "cachedPromptTokens",
        "completionTokens",
        "conversationId",
        "createdAt",
        "durationMs",
        "estimatedCost",
        "estimatedCostUsd",
        "id",
        "model",
        "promptTokens",
        "provider",
        "riskLevel",
        "source",
        "stage",
        "totalTokens",
      ].sort()
    );
    expect(item).not.toHaveProperty("body");
    expect(item).not.toHaveProperty("riskReasons");
    expect(item.estimatedCostUsd).toBe(0.00075);
    expect(result.recent.nextCursor).toBeNull();
    expect(result.recent.hasNextPage).toBe(false);
  });

  it("repassa o filtro, limit e cursor ao repositório", async () => {
    const repo = buildRepo({});
    const service = new AiUsageService(repo as never);
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-06-13T10:00:00.000Z", id: "log-1" }),
      "utf8"
    ).toString("base64url");

    await service.getUsage(filter, 15, cursor);

    expect(repo.getUsageSummary).toHaveBeenCalledWith(filter);
    expect(repo.listRecentUsage).toHaveBeenCalledWith(
      filter,
      15,
      expect.objectContaining({
        id: "log-1",
        createdAt: new Date("2026-06-13T10:00:00.000Z"),
      })
    );
  });
});
