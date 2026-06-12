import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import type {
  MetaWebhookAckResponse,
  MetaWebhookHeaders,
  MetaWebhookVerificationQuery,
} from "./WhatsAppWebhookTypes.js";
import { WhatsAppSignatureService } from "./WhatsAppSignatureService.js";

export class WhatsAppWebhookService {
  constructor(
    private readonly signatureService: WhatsAppSignatureService = new WhatsAppSignatureService()
  ) {}

  verifySubscription(query: MetaWebhookVerificationQuery): string {
    const mode = query["hub.mode"];
    const verifyToken = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (
      mode !== "subscribe" ||
      verifyToken !== env.META_VERIFY_TOKEN ||
      !challenge
    ) {
      throw new AppError({
        code: "META_WEBHOOK_FORBIDDEN",
        message: "Webhook verification failed",
        statusCode: 403,
      });
    }

    return challenge;
  }

  receiveWebhook(
    params: Readonly<{
      rawBody: Buffer | undefined;
      headers: MetaWebhookHeaders;
    }>
  ): MetaWebhookAckResponse {
    this.signatureService.validateSignature(
      params.rawBody,
      params.headers["x-hub-signature-256"]
    );

    return { received: true };
  }
}
