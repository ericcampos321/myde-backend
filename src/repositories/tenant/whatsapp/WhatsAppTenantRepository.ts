import { eq } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import { tenants, type NewTenantRow } from "../../../db/schema/index.js";
import type { UpsertWhatsAppTenantInput } from "../../../types/tenant/whatsapp/WhatsAppTenantTypes.js";

export class WhatsAppTenantRepository {
  constructor(private readonly database: Database = db) {}

  async findById(id: string) {
    const [tenant] = await this.database
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    return tenant ?? null;
  }

  async findByPhoneNumberId(phoneNumberId: string) {
    const [tenant] = await this.database
      .select()
      .from(tenants)
      .where(eq(tenants.phoneNumberId, phoneNumberId))
      .limit(1);
    return tenant ?? null;
  }

  async create(data: NewTenantRow) {
    const [tenant] = await this.database.insert(tenants).values(data).returning();
    return tenant;
  }

  async upsertByPhoneNumberId(data: UpsertWhatsAppTenantInput) {
    const [tenant] = await this.database
      .insert(tenants)
      .values(data)
      .onConflictDoUpdate({
        target: tenants.phoneNumberId,
        set: {
          name: data.name,
          wabaId: data.wabaId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return tenant;
  }
}
