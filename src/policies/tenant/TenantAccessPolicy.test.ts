import { describe, expect, it } from "vitest";
import { TenantAccessPolicy } from "./TenantAccessPolicy.js";

describe("TenantAccessPolicy", () => {
  describe("assertTenantId", () => {
    it("rejeita tenantId ausente", () => {
      expect(() => TenantAccessPolicy.assertTenantId(undefined)).toThrowError(
        expect.objectContaining({
          code: "TENANT_ID_REQUIRED",
          statusCode: 400,
        })
      );
    });

    it("rejeita tenantId vazio", () => {
      expect(() => TenantAccessPolicy.assertTenantId("   ")).toThrowError(
        expect.objectContaining({ code: "TENANT_ID_REQUIRED" })
      );
    });

    it("aceita tenantId presente", () => {
      expect(() =>
        TenantAccessPolicy.assertTenantId("tenant-1")
      ).not.toThrow();
    });
  });

  describe("assertResourceBelongsToTenant", () => {
    it("rejeita resourceTenantId diferente do requestTenantId", () => {
      expect(() =>
        TenantAccessPolicy.assertResourceBelongsToTenant("tenant-2", "tenant-1")
      ).toThrowError(
        expect.objectContaining({
          code: "TENANT_SCOPE_FORBIDDEN",
          statusCode: 403,
        })
      );
    });

    it("rejeita resourceTenantId ausente", () => {
      expect(() =>
        TenantAccessPolicy.assertResourceBelongsToTenant(null, "tenant-1")
      ).toThrowError(
        expect.objectContaining({ code: "TENANT_SCOPE_FORBIDDEN" })
      );
    });

    it("aceita resourceTenantId igual ao requestTenantId", () => {
      expect(() =>
        TenantAccessPolicy.assertResourceBelongsToTenant("tenant-1", "tenant-1")
      ).not.toThrow();
    });
  });
});
