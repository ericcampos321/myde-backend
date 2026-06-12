import type { WhatsAppTenantService } from "../../services/tenant/whatsapp/WhatsAppTenantService.js";
import type { TenantRow } from "../../db/schema/index.js";

/**
 * Resultado explícito da resolução de tenant. Sem exceções: o chamador decide
 * o que fazer com cada estado (webhook ignora, REST rejeita, etc.).
 */
export type TenantResolution =
  | { status: "found"; tenant: TenantRow }
  | { status: "unknown" }
  | { status: "missing" };

export interface TenantResolutionPolicyDependencies {
  tenantService: Pick<
    WhatsAppTenantService,
    "findByPhoneNumberId" | "findById"
  >;
}

/**
 * Concentra como um tenant é resolvido a partir do contexto da requisição.
 * Não acessa banco direto — delega ao WhatsAppTenantService. Não conhece
 * Fastify, HMAC, fila nem IA.
 */
export class TenantResolutionPolicy {
  private readonly tenantService: TenantResolutionPolicyDependencies["tenantService"];

  constructor(dependencies: TenantResolutionPolicyDependencies) {
    this.tenantService = dependencies.tenantService;
  }

  /** Webhook: resolve o tenant pelo `phone_number_id` recebido da Meta. */
  async resolveByPhoneNumberId(
    phoneNumberId: string | null | undefined
  ): Promise<TenantResolution> {
    if (!phoneNumberId || phoneNumberId.trim().length === 0) {
      return { status: "missing" };
    }

    const tenant = await this.tenantService.findByPhoneNumberId(phoneNumberId);
    if (!tenant) {
      return { status: "unknown" };
    }

    return { status: "found", tenant };
  }

  /** REST futura: resolve o tenant por um id explícito derivado da requisição. */
  async resolveById(
    tenantId: string | null | undefined
  ): Promise<TenantResolution> {
    if (!tenantId || tenantId.trim().length === 0) {
      return { status: "missing" };
    }

    const tenant = await this.tenantService.findById(tenantId);
    if (!tenant) {
      return { status: "unknown" };
    }

    return { status: "found", tenant };
  }
}
