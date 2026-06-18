import { samePhoneNumber } from "../../shared/utils/phone.js";

/**
 * Decisão centralizada de "o worker deve auto-responder ESTE inbound?".
 *
 * Regra-chave (por inbound específico X, não pela conversa inteira):
 *   - bloqueia se existe outbound MANUAL (replyToMessageId IS NULL) com
 *     createdAt >= X.createdAt  →  "manually_answered" (human takeover);
 *   - bloqueia se já existe auto-reply para X (outbound com replyToMessageId = X.id)
 *     →  "already_auto_replied" (idempotência);
 *   - uma resposta manual ANTERIOR a X não bloqueia: se o cliente manda um novo
 *     inbound depois, ele volta a ser elegível.
 *
 * Função pura e tenant-agnóstica: o chamador já passa as mensagens da conversa
 * (filtradas por tenant+conversa no repositório).
 */
export type AutoReplyDecisionReason =
  | "eligible"
  | "automation_disabled"
  | "non_inbound"
  | "anti_loop"
  | "manually_answered"
  | "already_auto_replied"
  | "empty_ai_response";

export type AutoReplyDecision =
  | { shouldReply: true; reason: "eligible" }
  | {
      shouldReply: false;
      reason: Exclude<AutoReplyDecisionReason, "eligible">;
    };

/** Mensagem mínima necessária para a decisão. */
export interface AutoReplyMessage {
  id: string;
  direction: string;
  replyToMessageId: string | null;
  createdAt: Date;
}

export interface AutoReplyPolicyInput {
  autoReplyEnabled: boolean;
  inbound: AutoReplyMessage;
  messages: ReadonlyArray<AutoReplyMessage>;
  /** Telefone do remetente (from). Para a trava anti-loop. */
  contactPhone?: string | null;
  /** Telefone real exibido da empresa (display_phone_number). Anti-loop. */
  companyPhone?: string | null;
  /**
   * Texto da IA. `undefined` na checagem PRÉ-IA (a vacuidade ainda não é
   * conhecida); string na checagem PRÉ-ENVIO.
   */
  aiText?: string | null;
}

export class AutoReplyPolicy {
  static decide(input: AutoReplyPolicyInput): AutoReplyDecision {
    if (!input.autoReplyEnabled) {
      return { shouldReply: false, reason: "automation_disabled" };
    }
    if (input.inbound.direction !== "inbound") {
      return { shouldReply: false, reason: "non_inbound" };
    }
    if (samePhoneNumber(input.contactPhone, input.companyPhone)) {
      return { shouldReply: false, reason: "anti_loop" };
    }
    if (hasManualReplyAfter(input.messages, input.inbound)) {
      return { shouldReply: false, reason: "manually_answered" };
    }
    if (hasAutoReplyFor(input.messages, input.inbound.id)) {
      return { shouldReply: false, reason: "already_auto_replied" };
    }
    if (input.aiText !== undefined) {
      const text = input.aiText?.trim() ?? "";
      if (!text) {
        return { shouldReply: false, reason: "empty_ai_response" };
      }
    }
    return { shouldReply: true, reason: "eligible" };
  }
}

/**
 * Existe resposta MANUAL do operador em/depois do inbound? Manual = outbound SEM
 * `replyToMessageId` (auto-replies sempre têm). Defensivo: sem createdAt confiável
 * não bloqueia (evita falso-positivo).
 */
export function hasManualReplyAfter(
  messages: ReadonlyArray<AutoReplyMessage>,
  inbound: AutoReplyMessage
): boolean {
  if (!(inbound.createdAt instanceof Date)) {
    return false;
  }
  const inboundTime = inbound.createdAt.getTime();
  return messages.some((m) => {
    if (m.direction !== "outbound") return false;
    if (m.replyToMessageId != null) return false; // auto-reply, não manual
    if (m.id === inbound.id) return false;
    if (!(m.createdAt instanceof Date)) return false;
    return m.createdAt.getTime() >= inboundTime;
  });
}

/** Já existe um auto-reply (outbound com replyToMessageId = inboundId)? */
export function hasAutoReplyFor(
  messages: ReadonlyArray<AutoReplyMessage>,
  inboundId: string
): boolean {
  return messages.some(
    (m) => m.direction === "outbound" && m.replyToMessageId === inboundId
  );
}
