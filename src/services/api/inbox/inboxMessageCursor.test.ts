import { describe, it, expect } from "vitest";
import {
  clampMessageLimit,
  decodeMessageCursor,
  encodeMessageCursor,
  MESSAGE_PAGE_LIMITS,
} from "./inboxMessageCursor.js";

describe("encode/decodeMessageCursor", () => {
  it("round-trip: codifica e decodifica (createdAt, id)", () => {
    const createdAt = new Date("2026-06-14T01:02:23.000Z");
    const id = "07bddbf1-6af4-4b16-9849-d937135e6218";

    const cursor = encodeMessageCursor({ createdAt, id });
    const decoded = decodeMessageCursor(cursor);

    expect(decoded).toEqual({ createdAtMs: createdAt.getTime(), id });
  });

  it("cursor inválido/ausente → null", () => {
    expect(decodeMessageCursor(undefined)).toBeNull();
    expect(decodeMessageCursor(null)).toBeNull();
    expect(decodeMessageCursor("")).toBeNull();
    expect(decodeMessageCursor("@@nao-base64@@")).toBeNull();
    // base64 de "semseparador"
    expect(decodeMessageCursor(Buffer.from("semseparador").toString("base64"))).toBeNull();
    // createdAt não numérico
    expect(decodeMessageCursor(Buffer.from("abc_id-1").toString("base64"))).toBeNull();
    // sem id
    expect(decodeMessageCursor(Buffer.from("123_").toString("base64"))).toBeNull();
  });
});

describe("clampMessageLimit", () => {
  it("default quando ausente/NaN/inválido/<1", () => {
    expect(clampMessageLimit(undefined)).toBe(MESSAGE_PAGE_LIMITS.default);
    expect(clampMessageLimit(NaN)).toBe(MESSAGE_PAGE_LIMITS.default);
    expect(clampMessageLimit("abc")).toBe(MESSAGE_PAGE_LIMITS.default);
    expect(clampMessageLimit(0)).toBe(MESSAGE_PAGE_LIMITS.default);
    expect(clampMessageLimit(-5)).toBe(MESSAGE_PAGE_LIMITS.default);
  });

  it("respeita o máximo", () => {
    expect(clampMessageLimit(999)).toBe(MESSAGE_PAGE_LIMITS.max);
    expect(clampMessageLimit("50")).toBe(50);
  });

  it("mantém valor válido no intervalo (floor)", () => {
    expect(clampMessageLimit(20)).toBe(20);
    expect(clampMessageLimit(30.9)).toBe(30);
  });
});
