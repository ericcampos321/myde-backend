import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetaGraphApiClient, metaModeOf } from "./MetaGraphApiClient.js";
import { env } from "../../config/env.js";

describe("metaModeOf", () => {
  it("detecta mock", () => {
    expect(metaModeOf("http://mock-meta:8001")).toBe("mock");
    expect(metaModeOf("http://localhost:8001")).toBe("mock");
    expect(metaModeOf("http://127.0.0.1:8001")).toBe("mock");
  });
  it("detecta real", () => {
    expect(metaModeOf("https://graph.facebook.com/v25.0")).toBe("real");
  });
  it("custom para o resto", () => {
    expect(metaModeOf("https://exemplo.com/api")).toBe("custom");
  });
});

describe("MetaGraphApiClient", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("montagem da URL e do request (fetch mockado)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function mockFetchOk() {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "wamid.resp-1" }] }),
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("monta {META_API_BASE_URL}/{phoneNumberId}/messages e Bearer + body corretos", async () => {
      const fetchMock = mockFetchOk();
      const client = new MetaGraphApiClient();

      const result = await client.sendText({
        phoneNumberId: "999888777",
        to: "5511999990000",
        body: "olá",
      });

      expect(result.externalMessageId).toBe("wamid.resp-1");

      const [url, init] = fetchMock.mock.calls[0]!;
      // Não hardcoda graph.facebook.com — usa a base configurada.
      expect(url).toBe(`${env.META_API_BASE_URL}/999888777/messages`);
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      // Contrato IDÊNTICO ao envio direto que funciona (recipient_type + preview_url).
      expect(JSON.parse(init.body)).toEqual({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "5511999990000",
        type: "text",
        text: { preview_url: false, body: "olá" },
      });
    });

    it("funciona com META_API_BASE_URL=http://mock-meta:8001", async () => {
      vi.stubEnv("META_API_BASE_URL", "http://mock-meta:8001");
      vi.stubEnv("META_TOKEN", "mock-token");
      vi.stubEnv("META_PHONE_NUMBER_ID", "123456789012345");
      vi.resetModules();
      const fetchMock = mockFetchOk();

      const { MetaGraphApiClient: Client } = await import(
        "./MetaGraphApiClient.js"
      );
      await new Client().sendText({
        phoneNumberId: "123456789012345",
        to: "5511999990000",
        body: "oi",
      });

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://mock-meta:8001/123456789012345/messages");
    });

    it("modo real (v25.0): URL real + payload do contrato direto + Bearer", async () => {
      vi.stubEnv("META_API_BASE_URL", "https://graph.facebook.com/v25.0");
      vi.stubEnv("META_TOKEN", "token-real");
      vi.stubEnv("META_PHONE_NUMBER_ID", "1157239980805635");
      vi.resetModules();
      const fetchMock = mockFetchOk();

      const { MetaGraphApiClient: Client } = await import(
        "./MetaGraphApiClient.js"
      );
      const result = await new Client().sendText({
        phoneNumberId: "1157239980805635",
        to: "5514991270311",
        body: "teste",
      });

      const [url, init] = fetchMock.mock.calls[0]!;
      // URL real correta (igual ao envio direto que funciona).
      expect(url).toBe(
        "https://graph.facebook.com/v25.0/1157239980805635/messages"
      );
      // Authorization Bearer enviado.
      expect(init.headers.Authorization).toBe("Bearer token-real");
      // Body idêntico ao contrato direto que funciona.
      const body = JSON.parse(init.body);
      expect(body.messaging_product).toBe("whatsapp");
      expect(body.recipient_type).toBe("individual");
      expect(body.type).toBe("text");
      expect(body.text.preview_url).toBe(false);
      expect(body.text.body).toBe("teste");
      expect(body.to).toBe("5514991270311");
      // externalMessageId = response.messages[0].id.
      expect(result.externalMessageId).toBe("wamid.resp-1");
    });
  });

  it("lança erro se META_API_BASE_URL não configurado", () => {
    vi.stubEnv("META_API_BASE_URL", "");
    vi.stubEnv("META_TOKEN", "token-test");
    vi.stubEnv("META_PHONE_NUMBER_ID", "123456789");

    // Force reimport
    vi.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MetaGraphApiClient: Client } = require("./MetaGraphApiClient.js");
      new Client();
    }).toThrow();
  });

  it("lança erro se META_TOKEN não configurado", () => {
    vi.stubEnv("META_API_BASE_URL", "https://graph.facebook.com/v20.0");
    vi.stubEnv("META_TOKEN", "");
    vi.stubEnv("META_PHONE_NUMBER_ID", "123456789");

    vi.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MetaGraphApiClient: Client } = require("./MetaGraphApiClient.js");
      new Client();
    }).toThrow();
  });

  it("lança erro se META_PHONE_NUMBER_ID não configurado", () => {
    vi.stubEnv("META_API_BASE_URL", "https://graph.facebook.com/v20.0");
    vi.stubEnv("META_TOKEN", "token-test");
    vi.stubEnv("META_PHONE_NUMBER_ID", "");

    vi.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MetaGraphApiClient: Client } = require("./MetaGraphApiClient.js");
      new Client();
    }).toThrow();
  });
});