import type {
  MetaWebhookMappingResult,
  NormalizedInboundMessage,
} from "../../../types/tenant/whatsapp/WhatsAppWebhookTypes.js";

interface MetaWebhookPayload {
  entry?: Array<{
    id?: unknown;
    changes?: Array<{
      value?: {
        metadata?: {
          phone_number_id?: unknown;
          display_phone_number?: unknown;
        };
        contacts?: Array<{
          wa_id?: unknown;
          profile?: { name?: unknown };
        }>;
        messages?: Array<{
          from?: unknown;
          id?: unknown;
          timestamp?: unknown;
          type?: unknown;
          text?: { body?: unknown };
        }>;
        // Eventos de status de entrega de outbound (sent/delivered/read/failed).
        statuses?: Array<{
          id?: unknown;
          status?: unknown;
          errors?: Array<{ code?: unknown; title?: unknown; message?: unknown }>;
        }>;
      };
    }>;
  }>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class WhatsAppPayloadMapper {
  map(payload: unknown): MetaWebhookMappingResult {
    const entry = (payload as MetaWebhookPayload | null)?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    const phoneNumberId = nonEmptyString(value?.metadata?.phone_number_id);
    const displayPhoneNumber = nonEmptyString(
      value?.metadata?.display_phone_number
    );
    const wabaId = nonEmptyString(entry?.id);
    const externalMessageId = nonEmptyString(message?.id);
    const contactPhone =
      nonEmptyString(message?.from) ?? nonEmptyString(contact?.wa_id);
    const text = nonEmptyString(message?.text?.body);
    const timestampSeconds = nonEmptyString(message?.timestamp);

    const isProcessableText =
      message?.type === "text" &&
      phoneNumberId &&
      wabaId &&
      externalMessageId &&
      contactPhone &&
      text &&
      timestampSeconds;

    if (!isProcessableText) {
      // Evento de status de entrega de outbound: extrai os status para log/diagnóstico
      // (sent/delivered/read/failed). Não é "unsupported"; é esperado e não vira erro.
      const rawStatuses = value?.statuses;
      if (Array.isArray(rawStatuses) && rawStatuses.length > 0) {
        const statuses = rawStatuses
          .map((s) => {
            const messageId = nonEmptyString(s?.id);
            const status = nonEmptyString(s?.status);
            if (!messageId || !status) return null;
            const firstError = s?.errors?.[0];
            const errorCode =
              typeof firstError?.code === "number" ? firstError.code : null;
            const errorTitle =
              nonEmptyString(firstError?.title) ??
              nonEmptyString(firstError?.message);
            return { messageId, status, errorCode, errorTitle };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        return { kind: "status", phoneNumberId, statuses };
      }
      return { kind: "ignored", reason: "unsupported_event" };
    }

    const timestamp = new Date(Number(timestampSeconds) * 1000);
    if (Number.isNaN(timestamp.getTime())) {
      return { kind: "ignored", reason: "unsupported_event" };
    }

    const normalized: NormalizedInboundMessage = {
      phoneNumberId,
      displayPhoneNumber,
      wabaId,
      externalMessageId,
      contactPhone,
      contactName: nonEmptyString(contact?.profile?.name),
      text,
      timestamp,
    };

    return { kind: "message", message: normalized };
  }
}
