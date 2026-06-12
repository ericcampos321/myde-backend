import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../bootstrap/app.js";
import { hmacSha256Hex } from "../../../shared/utils/crypto.js";

let app: FastifyInstance;

const metaPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_TESTE_0001",
      changes: [
        {
          value: {
            metadata: {
              phone_number_id: "123456789012345",
            },
            contacts: [
              {
                profile: { name: "Cliente Teste" },
                wa_id: "5511999990000",
              },
            ],
            messages: [
              {
                from: "5511999990000",
                id: "wamid.test-1",
                timestamp: "1760000000",
                type: "text",
                text: { body: "Quais sao os planos?" },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

const appSecret =
  process.env.META_APP_SECRET ?? "super-secret-app-secret-trocar";
const verifyToken =
  process.env.META_VERIFY_TOKEN ?? "meu-verify-token-secreto";

function signPayload(rawBody: string | Buffer): string {
  return hmacSha256Hex(
    typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody,
    appSecret
  );
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /webhook", () => {
  it("retorna challenge quando o token e valido", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=12345`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("12345");
  });

  it("retorna 403 quando o token e invalido", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhook?hub.mode=subscribe&hub.verify_token=invalido&hub.challenge=12345",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "META_WEBHOOK_FORBIDDEN",
    });
  });
});

describe("POST /webhook", () => {
  it("aceita assinatura valida", async () => {
    const rawBody = JSON.stringify(metaPayload);
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(rawBody),
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });

  it("rejeita assinatura invalida", async () => {
    const rawBody = JSON.stringify(metaPayload);
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(
          JSON.stringify({ ...metaPayload, object: "other" })
        ),
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "META_SIGNATURE_INVALID",
    });
  });

  it("rejeita assinatura ausente", async () => {
    const rawBody = JSON.stringify(metaPayload);
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      code: "META_SIGNATURE_MISSING",
    });
  });

  it("rejeita assinatura malformada", async () => {
    const rawBody = JSON.stringify(metaPayload);
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "invalid-signature",
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      code: "META_SIGNATURE_MALFORMED",
    });
  });

  it("valida usando o raw body real, nao o objeto parseado", async () => {
    const rawBody = JSON.stringify(metaPayload, null, 2);
    const normalizedSignature = signPayload(
      JSON.stringify(JSON.parse(rawBody))
    );

    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-hub-signature-256": normalizedSignature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "META_SIGNATURE_INVALID",
    });
  });
});
