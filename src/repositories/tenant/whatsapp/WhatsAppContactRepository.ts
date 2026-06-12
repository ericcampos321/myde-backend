import { and, eq } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import { whatsappContacts } from "../../../models/db/schema.js";
import type { UpsertWhatsAppContactInput } from "../../../types/tenant/whatsapp/WhatsAppContactTypes.js";

export class WhatsAppContactRepository {
  constructor(private readonly database: Database = db) {}

  async findById(tenantId: string, id: string) {
    const [contact] = await this.database
      .select()
      .from(whatsappContacts)
      .where(
        and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.id, id))
      )
      .limit(1);
    return contact ?? null;
  }

  async findByPhone(tenantId: string, phone: string) {
    const [contact] = await this.database
      .select()
      .from(whatsappContacts)
      .where(
        and(
          eq(whatsappContacts.tenantId, tenantId),
          eq(whatsappContacts.phone, phone)
        )
      )
      .limit(1);
    return contact ?? null;
  }

  async upsertByPhone(data: UpsertWhatsAppContactInput) {
    const [contact] = await this.database
      .insert(whatsappContacts)
      .values(data)
      .onConflictDoUpdate({
        target: [whatsappContacts.tenantId, whatsappContacts.phone],
        set: {
          name: data.name,
          updatedAt: new Date(),
        },
      })
      .returning();
    return contact;
  }
}
