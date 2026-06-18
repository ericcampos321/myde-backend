import { describe, expect, it, vi } from "vitest";

// Simula ambiente real (dev/prod) sem credencial Meta: env sem META_APP_SECRET.
vi.mock("../../../config/env.js", () => ({
  env: { META_APP_SECRET: undefined },
}));

const { WhatsAppSignatureService } = await import("./WhatsAppSignatureService.js");

describe("WhatsAppSignatureService sem META_APP_SECRET (dev/prod)", () => {
  it("falha explícito de configuração em vez de aceitar mock silencioso", () => {
    const service = new WhatsAppSignatureService();
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const wellFormedSignature = `sha256=${"a".repeat(64)}`;

    try {
      service.validateSignature(rawBody, wellFormedSignature);
      expect.unreachable("Era esperado erro de configuração ausente");
    } catch (error) {
      expect(error).toMatchObject({
        code: "META_APP_SECRET_NOT_CONFIGURED",
        statusCode: 500,
      });
    }
  });
});