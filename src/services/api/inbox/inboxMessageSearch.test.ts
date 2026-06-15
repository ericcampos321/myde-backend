import { describe, it, expect } from "vitest";
import {
  buildBodyPreview,
  clampSearchLimit,
  escapeLikeSearchTerm,
  MESSAGE_SEARCH,
} from "./inboxMessageSearch.js";

describe("escapeLikeSearchTerm", () => {
  it("escapa %, _ e \\ (barra primeiro)", () => {
    expect(escapeLikeSearchTerm("100%")).toBe("100\\%");
    expect(escapeLikeSearchTerm("abc_def")).toBe("abc\\_def");
    expect(escapeLikeSearchTerm("a\\b")).toBe("a\\\\b");
    expect(escapeLikeSearchTerm("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
  });

  it("termo sem especiais permanece igual", () => {
    expect(escapeLikeSearchTerm("eric")).toBe("eric");
  });
});

describe("clampSearchLimit", () => {
  it("default 20 quando inválido/NaN/<1", () => {
    expect(clampSearchLimit(undefined)).toBe(MESSAGE_SEARCH.defaultLimit);
    expect(clampSearchLimit(NaN)).toBe(20);
    expect(clampSearchLimit("abc")).toBe(20);
    expect(clampSearchLimit(0)).toBe(20);
    expect(clampSearchLimit(-3)).toBe(20);
  });

  it("respeita o máximo 50 e valores válidos", () => {
    expect(clampSearchLimit(999)).toBe(50);
    expect(clampSearchLimit(15)).toBe(15);
    expect(clampSearchLimit("30")).toBe(30);
  });
});

describe("buildBodyPreview", () => {
  it("body curto: retorna body inteiro + matchedText preservando o caso original", () => {
    const { bodyPreview, matchedText } = buildBodyPreview("Suave Eric tudo bem", "er");
    expect(bodyPreview).toBe("Suave Eric tudo bem");
    // primeiro "er" case-insensitive está em "Eric" → preserva o caso original "Er"
    expect(matchedText).toBe("Er");
  });

  it("sem match em body curto: matchedText null", () => {
    const { bodyPreview, matchedText } = buildBodyPreview("Olá mundo", "xyz");
    expect(bodyPreview).toBe("Olá mundo");
    expect(matchedText).toBeNull();
  });

  it("body longo com match: janela centrada com reticências", () => {
    const body = "a".repeat(300) + "ALVO" + "b".repeat(300);
    const { bodyPreview, matchedText } = buildBodyPreview(body, "alvo", 50);
    expect(matchedText).toBe("ALVO");
    expect(bodyPreview).toContain("ALVO");
    expect(bodyPreview.startsWith("…")).toBe(true);
    expect(bodyPreview.endsWith("…")).toBe(true);
    // preview limitado (janela + reticências)
    expect(bodyPreview.length).toBeLessThanOrEqual(50 + 2);
  });

  it("body longo sem match: trecho inicial truncado", () => {
    const body = "x".repeat(500);
    const { bodyPreview, matchedText } = buildBodyPreview(body, "zzz", 100);
    expect(matchedText).toBeNull();
    expect(bodyPreview.endsWith("…")).toBe(true);
    expect(bodyPreview.length).toBe(101);
  });
});
