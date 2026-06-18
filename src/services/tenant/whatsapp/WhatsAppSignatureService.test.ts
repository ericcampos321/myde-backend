import { describe, expect, it } from "vitest";
import { env } from "../../../config/env.js";
import { hmacSha256Hex } from "../../../shared/utils/crypto.js";
import { WhatsAppSignatureService } from "./WhatsAppSignatureService.js";

describe("WhatsAppSignatureService", () => {
  const signatureService = new WhatsAppSignatureService();
  // Mesma fonte que o serviço valida, alinhando assinatura e verificação.
  const secret = env.META_APP_SECRET;

  it("aceita assinatura valida para o raw body exato", () => {
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = hmacSha256Hex(rawBody, secret);

    expect(() =>
      signatureService.validateSignature(rawBody, signature)
    ).not.toThrow();
  });

  it("rejeita quando a assinatura foi calculada com outro raw body", () => {
    const rawBody = Buffer.from('{\n  "object": "whatsapp_business_account"\n}');
    const normalizedBody = Buffer.from(
      JSON.stringify(JSON.parse(rawBody.toString("utf8")))
    );
    const signature = hmacSha256Hex(normalizedBody, secret);

    try {
      signatureService.validateSignature(rawBody, signature);
      expect.unreachable("Era esperado erro de assinatura invalida");
    } catch (error) {
      expect(error).toMatchObject({
        code: "META_SIGNATURE_INVALID",
        statusCode: 403,
      });
    }
  });
});
