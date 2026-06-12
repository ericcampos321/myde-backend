import type {
  MetaWebhookMappingResult,
  NormalizedInboundMessage,
} from "../../../types/tenant/whatsapp/WhatsAppWebhookTypes.js";

interface MetaWebhookPayload {
  entry?: Array<{
    id?: unknown;
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: unknown };
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
    const wabaId = nonEmptyString(entry?.id);
    const externalMessageId = nonEmptyString(message?.id);
    const contactPhone =
      nonEmptyString(message?.from) ?? nonEmptyString(contact?.wa_id);
    const text = nonEmptyString(message?.text?.body);
    const timestampSeconds = nonEmptyString(message?.timestamp);

    if (
      message?.type !== "text" ||
      !phoneNumberId ||
      !wabaId ||
      !externalMessageId ||
      !contactPhone ||
      !text ||
      !timestampSeconds
    ) {
      return { kind: "ignored", reason: "unsupported_event" };
    }

    const timestamp = new Date(Number(timestampSeconds) * 1000);
    if (Number.isNaN(timestamp.getTime())) {
      return { kind: "ignored", reason: "unsupported_event" };
    }

    const normalized: NormalizedInboundMessage = {
      phoneNumberId,
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
