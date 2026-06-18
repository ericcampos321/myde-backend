import type { Logger } from "pino";
import { createLogger } from "../../../shared/logger/logger.js";
import { WhatsAppContactRepository } from "../../../repositories/tenant/whatsapp/WhatsAppContactRepository.js";
import type { WhatsAppContactRow } from "../../../db/schema/index.js";
import type { UpsertWhatsAppContactInput } from "../../../types/tenant/whatsapp/WhatsAppContactTypes.js";

export interface WhatsAppContactServiceDependencies {
  contactRepository?: WhatsAppContactRepository;
  log?: Logger;
}

export class WhatsAppContactService {
  private readonly contactRepository: WhatsAppContactRepository;
  private readonly log: Logger;

  constructor(dependencies: WhatsAppContactServiceDependencies = {}) {
    this.contactRepository =
      dependencies.contactRepository ?? new WhatsAppContactRepository();
    this.log = dependencies.log ?? createLogger({ module: "whatsapp-contact" });
  }

  async findById(tenantId: string, id: string): Promise<WhatsAppContactRow | null> {
    return this.contactRepository.findById(tenantId, id);
  }

  async findByPhone(
    tenantId: string,
    phone: string
  ): Promise<WhatsAppContactRow | null> {
    return this.contactRepository.findByPhone(tenantId, phone);
  }

  async upsertByPhone(
    input: UpsertWhatsAppContactInput
  ): Promise<WhatsAppContactRow | undefined> {
    const contact = await this.contactRepository.upsertByPhone(input);
    this.log.debug(
      { tenantId: input.tenantId, phone: input.phone },
      "contact upserted"
    );
    return contact;
  }
}