import { describe, it, expect } from "vitest";
import {
  AI_USAGE,
  clampUsageLimit,
  parseUsageDate,
  resolveUsageWindow,
} from "./aiUsageQuery.js";

const DAY = 24 * 60 * 60 * 1000;

describe("clampUsageLimit", () => {
  it("default quando ausente/inválido/<1", () => {
    expect(clampUsageLimit(undefined)).toBe(AI_USAGE.defaultLimit);
    expect(clampUsageLimit("abc")).toBe(20);
    expect(clampUsageLimit(0)).toBe(20);
    expect(clampUsageLimit(-3)).toBe(20);
  });

  it("respeita o máximo 100", () => {
    expect(clampUsageLimit(9999)).toBe(100);
    expect(clampUsageLimit(50)).toBe(50);
  });
});

describe("parseUsageDate", () => {
  it("ISO válido → Date; inválido/empty → null", () => {
    expect(parseUsageDate("2026-06-14T00:00:00.000Z")).toBeInstanceOf(Date);
    expect(parseUsageDate("lixo")).toBeNull();
    expect(parseUsageDate("")).toBeNull();
    expect(parseUsageDate(123)).toBeNull();
  });
});

describe("resolveUsageWindow", () => {
  const now = new Date("2026-06-14T12:00:00.000Z");

  it("default: últimos 7 dias até agora", () => {
    const { from, to } = resolveUsageWindow({}, now);
    expect(to).toEqual(now);
    expect(to.getTime() - from.getTime()).toBe(AI_USAGE.defaultWindowDays * DAY);
  });

  it("respeita from/to válidos", () => {
    const { from, to } = resolveUsageWindow(
      { from: "2026-06-10T00:00:00.000Z", to: "2026-06-12T00:00:00.000Z" },
      now
    );
    expect(from.toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-06-12T00:00:00.000Z");
  });

  it("janela maior que o máximo é recortada (90 dias)", () => {
    const { from, to } = resolveUsageWindow(
      { from: "2020-01-01T00:00:00.000Z", to: "2026-06-14T00:00:00.000Z" },
      now
    );
    expect(to.getTime() - from.getTime()).toBe(AI_USAGE.maxWindowDays * DAY);
  });

  it("from >= to é corrigido para o default", () => {
    const { from, to } = resolveUsageWindow(
      { from: "2026-06-14T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z" },
      now
    );
    expect(from.getTime()).toBeLessThan(to.getTime());
    expect(to.getTime() - from.getTime()).toBe(AI_USAGE.defaultWindowDays * DAY);
  });
});
