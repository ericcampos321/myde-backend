import { AppError } from "../../errors/AppError.js";

/**
 * Regras de isolamento multi-tenant reutilizáveis. Funções puras que lançam
 * AppError com código/status estáveis quando a invariante é violada — pensadas
 * para as futuras rotas REST (`/conversations`, `/conversations/:id/messages`).
 * Não conhece banco, Fastify, HMAC, fila nem IA.
 */
export class TenantAccessPolicy {
  /** Garante que a operação recebeu um tenantId não vazio. */
  static assertTenantId(
    tenantId: string | null | undefined
  ): asserts tenantId is string {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new AppError({
        code: "TENANT_ID_REQUIRED",
        message: "Tenant id is required for this operation",
        statusCode: 400,
      });
    }
  }

  /**
   * Garante que o recurso consultado pertence ao tenant da requisição.
   * Bloqueia acesso cross-tenant com 403.
   */
  static assertResourceBelongsToTenant(
    resourceTenantId: string | null | undefined,
    requestTenantId: string | null | undefined
  ): void {
    TenantAccessPolicy.assertTenantId(requestTenantId);

    if (!resourceTenantId || resourceTenantId !== requestTenantId) {
      throw new AppError({
        code: "TENANT_SCOPE_FORBIDDEN",
        message: "Resource does not belong to the current tenant",
        statusCode: 403,
      });
    }
  }
}
