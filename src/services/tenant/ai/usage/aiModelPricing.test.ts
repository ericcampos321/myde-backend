import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "./aiModelPricing.js";

describe("estimateCostUsd", () => {
  it("calcula custo para gpt-5.4 com promptTokens/completionTokens", () => {
    expect(estimateCostUsd("gpt-5.4", 2719, 53)).toBe(0.007593);
  });

  it("calcula custo mesmo sem cachedPromptTokens", () => {
    expect(estimateCostUsd("gpt-5.4", 1000, 1000)).toBe(0.0175);
  });

  it("aplica cachedPromptTokens com preço de cached input", () => {
    // 800 input normal * 2.50/1M + 200 cached * 0.25/1M + 1000 output * 15/1M
    expect(estimateCostUsd("gpt-5.4", 1000, 1000, 200)).toBe(0.01705);
  });

  it("aplica multiplicador batch", () => {
    expect(estimateCostUsd("gpt-5.4", 1000, 1000, 0, "batch")).toBe(0.00875);
  });

  it("aplica multiplicador data_residency", () => {
    expect(estimateCostUsd("gpt-5.4", 1000, 1000, 0, "data_residency")).toBe(
      0.01925
    );
  });

  it("aceita snapshots/aliases por prefixo", () => {
    expect(estimateCostUsd("gpt-5.4-2026-06-01", 1000, 0)).toBe(0.0025);
    expect(estimateCostUsd("gpt-5.4-mini-2026-06-01", 1000, 0)).toBe(
      0.00075
    );
    expect(estimateCostUsd("gpt-5.4-nano-2026-06-01", 1000, 0)).toBe(0.0002);
  });

  it("calcula custo para modelo conhecido (input + output)", () => {
    // gpt-4o-mini: input 0.00015/1k, output 0.0006/1k
    // 1000 prompt + 1000 completion = 0.00015 + 0.0006 = 0.00075
    expect(estimateCostUsd("gpt-4o-mini", 1000, 1000)).toBe(0.00075);
  });

  it("modelo desconhecido → null (não inventa valor)", () => {
    expect(estimateCostUsd("modelo-inexistente", 500, 500)).toBeNull();
  });

  it("model null/undefined → null", () => {
    expect(estimateCostUsd(null, 100, 100)).toBeNull();
    expect(estimateCostUsd(undefined, 100, 100)).toBeNull();
  });

  it("sem tokens (ambos null) → null", () => {
    expect(estimateCostUsd("gpt-4o", null, null)).toBeNull();
  });

  it("token parcialmente null conta como 0", () => {
    // gpt-4o output 0.015/1k → 1000 completion = 0.015
    expect(estimateCostUsd("gpt-4o", null, 1000)).toBe(0.015);
  });
});
