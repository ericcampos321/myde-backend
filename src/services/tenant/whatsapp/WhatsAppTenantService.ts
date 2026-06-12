import type { Logger } from "pino";
import { createLogger } from "../../../shared/logger/logger.js";
import { WhatsAppTenantRepository } from "../../../repositories/tenant/whatsapp/WhatsAppTenantRepository.js";
import type { UpsertWhatsAppTenantInput, Tenant } from "../../../types/tenant/whatsapp/WhatsAppTenantTypes.js";

export interface WhatsAppTenantServiceDependencies {
  tenantRepository?: WhatsAppTenantRepository;
  log?: Logger;
}

export class WhatsAppTenantService {
  private readonly tenantRepository: WhatsAppTenantRepository;
  private readonly log: Logger;

  constructor(dependencies: WhatsAppTenantServiceDependencies = {}) {
    this.tenantRepository =
      dependencies.tenantRepository ?? new WhatsAppTenantRepository();
    this.log = dependencies.log ?? createLogger({ module: "whatsapp-tenant" });
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.tenantRepository.findById(id);
  }

  async findByPhoneNumberId(phoneNumberId: string): Promise<Tenant | null> {
    return this.tenantRepository.findByPhoneNumberId(phoneNumberId);
  }

  async resolveByPhoneNumberId(phoneNumberId: string): Promise<Tenant | null> {
    const tenant = await this.tenantRepository.findByPhoneNumberId(
      phoneNumberId
    );
    if (!tenant) {
      this.log.debug({ phoneNumberId }, "tenant not found by phoneNumberId");
    }
    return tenant;
  }

  async upsertByPhoneNumberId(
    input: UpsertWhatsAppTenantInput
  ): Promise<Tenant | undefined> {
    const tenant = await this.tenantRepository.upsertByPhoneNumberId(input);
    this.log.debug(
      { tenantId: tenant?.id, phoneNumberId: input.phoneNumberId },
      "tenant upserted"
    );
    return tenant;
  }
}
