import { describe, expect, it } from "vitest";
import { WebhookDeliveryPolicy } from "./WebhookDeliveryPolicy.js";

describe("WebhookDeliveryPolicy", () => {
  it("decide ignored com reason unknown_tenant", () => {
    expect(WebhookDeliveryPolicy.ignoredUnknownTenant()).toEqual({
      received: true,
      ignored: true,
      reason: "unknown_tenant",
    });
  });

  it("decide ignored com reason unsupported_event", () => {
    expect(WebhookDeliveryPolicy.ignoredUnsupportedEvent()).toEqual({
      received: true,
      ignored: true,
      reason: "unsupported_event",
    });
  });

  it("decide duplicated sem repersistir", () => {
    expect(WebhookDeliveryPolicy.duplicated()).toEqual({
      received: true,
      persisted: false,
      duplicated: true,
    });
  });

  it("decide persisted para mensagem nova", () => {
    expect(WebhookDeliveryPolicy.persisted()).toEqual({
      received: true,
      persisted: true,
      duplicated: false,
    });
  });
});
