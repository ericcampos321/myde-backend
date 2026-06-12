import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/AppError.js";
import { hmacSha256Hex, safeCompare } from "../../shared/utils/crypto.js";

const META_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/;

export class WhatsAppSignatureService {
  validateSignature(rawBody: Buffer | undefined, signatureHeader?: string): void {
    if (!signatureHeader) {
      throw new AppError({
        code: "META_SIGNATURE_MISSING",
        message: "Missing X-Hub-Signature-256 header",
        statusCode: 401,
      });
    }

    if (!META_SIGNATURE_PATTERN.test(signatureHeader)) {
      throw new AppError({
        code: "META_SIGNATURE_MALFORMED",
        message: "Malformed X-Hub-Signature-256 header",
        statusCode: 401,
      });
    }

    if (!rawBody) {
      throw new AppError({
        code: "META_RAW_BODY_MISSING",
        message: "Missing raw request body",
        statusCode: 400,
      });
    }

    const expectedSignature = hmacSha256Hex(rawBody, env.META_APP_SECRET);
    if (!safeCompare(expectedSignature, signatureHeader)) {
      throw new AppError({
        code: "META_SIGNATURE_INVALID",
        message: "Invalid X-Hub-Signature-256 signature",
        statusCode: 403,
      });
    }
  }
}
