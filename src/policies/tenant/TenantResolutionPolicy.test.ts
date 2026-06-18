import { describe, expect, it } from "vitest";
import { TenantResolutionPolicy } from "./TenantResolutionPolicy.js";
import type { TenantRow } from "../../db/schema/index.js";

const tenant: TenantRow = {
  id: "tenant-1",
  name: "Tenant Teste",
  phoneNumberId: "123456789012345",
  wabaId: "WABA_TEST",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildPolicy(tenantOrNull: TenantRow | null) {
  return new TenantResolutionPolicy({
    tenantService: {
      async findByPhoneNumberId() {
        return tenantOrNull;
      },
      async findById() {
        return tenantOrNull;
      },
    },
  });
}

describe("TenantResolutionPolicy", () => {
  it("retorna unknown quando o service nao encontra o tenant", async () => {
    const policy = buildPolicy(null);

    const result = await policy.resolveByPhoneNumberId("123456789012345");

    expect(result).toEqual({ status: "unknown" });
  });

  it("retorna found quando o service encontra o tenant", async () => {
    const policy = buildPolicy(tenant);

    const result = await policy.resolveByPhoneNumberId("123456789012345");

    expect(result).toEqual({ status: "found", tenant });
  });

  it("retorna missing quando o phoneNumberId esta ausente", async () => {
    const policy = buildPolicy(tenant);

    const result = await policy.resolveByPhoneNumberId("");

    expect(result).toEqual({ status: "missing" });
  });
});
