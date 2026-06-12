import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaGraphApiClient } from "./MetaGraphApiClient.js";

describe("MetaGraphApiClient", () => {
  beforeEach(() => {
    vi.resetModules();
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