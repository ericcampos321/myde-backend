import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone, samePhoneNumber } from "./phone.js";

describe("normalizePhone", () => {
  it("remove +, espaços, hífens e parênteses", () => {
    expect(normalizePhone("+55 (15) 99127-0311")).toBe("5515991270311");
  });
  it("retorna '' para vazio/nulo", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("samePhoneNumber", () => {
  it("true para mesmo número com formatações diferentes", () => {
    expect(samePhoneNumber("+55 15 99127-0311", "5515991270311")).toBe(true);
  });
  it("false para números diferentes", () => {
    expect(samePhoneNumber("5511999990000", "5515991270311")).toBe(false);
  });
  it("false quando algum lado é vazio (evita falso-positivo)", () => {
    expect(samePhoneNumber(null, null)).toBe(false);
    expect(samePhoneNumber("5515991270311", undefined)).toBe(false);
    expect(samePhoneNumber("", "")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("mantém só os 4 últimos dígitos", () => {
    expect(maskPhone("5515991270311")).toBe("****0311");
  });
  it("retorna **** para curto/vazio", () => {
    expect(maskPhone("12")).toBe("****");
    expect(maskPhone(null)).toBe("****");
  });
});
