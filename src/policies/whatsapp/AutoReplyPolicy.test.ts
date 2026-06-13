import { describe, expect, it } from "vitest";
import { AutoReplyPolicy, type AutoReplyMessage } from "./AutoReplyPolicy.js";

const t = (iso: string) => new Date(iso);

function inbound(id: string, at: string): AutoReplyMessage {
  return { id, direction: "inbound", replyToMessageId: null, createdAt: t(at) };
}
function manual(id: string, at: string): AutoReplyMessage {
  return { id, direction: "outbound", replyToMessageId: null, createdAt: t(at) };
}
function autoReply(id: string, replyTo: string, at: string): AutoReplyMessage {
  return { id, direction: "outbound", replyToMessageId: replyTo, createdAt: t(at) };
}

const base = {
  autoReplyEnabled: true,
  contactPhone: "5511999990000",
  companyPhone: "5599999999999",
  aiText: "resposta",
};

describe("AutoReplyPolicy.decide", () => {
  it("automation_disabled quando a flag está off", () => {
    const A = inbound("A", "2026-01-01T01:00:00Z");
    expect(
      AutoReplyPolicy.decide({ ...base, autoReplyEnabled: false, inbound: A, messages: [A] })
    ).toEqual({ shouldReply: false, reason: "automation_disabled" });
  });

  it("non_inbound quando a mensagem não é inbound", () => {
    const X = manual("X", "2026-01-01T01:00:00Z");
    expect(
      AutoReplyPolicy.decide({ ...base, inbound: X, messages: [X] })
    ).toEqual({ shouldReply: false, reason: "non_inbound" });
  });

  it("anti_loop quando o remetente é o número da empresa", () => {
    const A = inbound("A", "2026-01-01T01:00:00Z");
    expect(
      AutoReplyPolicy.decide({
        ...base,
        inbound: A,
        messages: [A],
        contactPhone: "+55 99 99999-9999",
        companyPhone: "5599999999999",
      })
    ).toEqual({ shouldReply: false, reason: "anti_loop" });
  });

  it("eligible quando não há resposta manual nem auto-reply", () => {
    const A = inbound("A", "2026-01-01T01:00:00Z");
    expect(
      AutoReplyPolicy.decide({ ...base, inbound: A, messages: [A] })
    ).toEqual({ shouldReply: true, reason: "eligible" });
  });

  it("manually_answered: outbound manual em/depois do inbound bloqueia", () => {
    const A = inbound("A", "2026-01-01T01:20:00Z");
    const m = manual("M", "2026-01-01T01:21:00Z");
    expect(
      AutoReplyPolicy.decide({ ...base, inbound: A, messages: [A, m] })
    ).toEqual({ shouldReply: false, reason: "manually_answered" });
  });

  it("already_auto_replied quando já existe auto-reply para o inbound", () => {
    const A = inbound("A", "2026-01-01T01:20:00Z");
    const ar = autoReply("AR", "A", "2026-01-01T01:20:05Z");
    expect(
      AutoReplyPolicy.decide({ ...base, inbound: A, messages: [A, ar] })
    ).toEqual({ shouldReply: false, reason: "already_auto_replied" });
  });

  it("empty_ai_response quando aiText é vazio/branco", () => {
    const A = inbound("A", "2026-01-01T01:00:00Z");
    expect(
      AutoReplyPolicy.decide({ ...base, inbound: A, messages: [A], aiText: "   " })
    ).toEqual({ shouldReply: false, reason: "empty_ai_response" });
  });

  // Cenário do enunciado (3): manual ANTERIOR não bloqueia uma inbound NOVA.
  it("manual anterior + nova inbound posterior → eligible (responde a nova)", () => {
    const A = inbound("A", "2026-01-01T01:20:00Z");
    const m = manual("M", "2026-01-01T01:21:00Z"); // resposta manual ao A
    const B = inbound("B", "2026-01-01T01:40:00Z"); // cliente escreve de novo

    const decision = AutoReplyPolicy.decide({
      ...base,
      inbound: B,
      messages: [A, m, B],
    });

    expect(decision).toEqual({ shouldReply: true, reason: "eligible" });
  });

  // Cenário do enunciado (4): múltiplas inbound, última sem resposta → responde.
  it("múltiplas inbound, última sem outbound posterior → eligible", () => {
    const A = inbound("A", "2026-01-01T01:00:00Z");
    const B = inbound("B", "2026-01-01T01:01:00Z");

    expect(
      AutoReplyPolicy.decide({ ...base, inbound: B, messages: [A, B] })
    ).toEqual({ shouldReply: true, reason: "eligible" });
  });
});
