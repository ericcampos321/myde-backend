import { and, desc, eq } from "drizzle-orm";
import { db, type Database } from "../../db/client.js";
import { whatsappConversations } from "../../db/schema.js";
import type { UpsertOpenConversationInput } from "./WhatsAppConversationTypes.js";

export class WhatsAppConversationRepository {
  constructor(private readonly database: Database = db) {}

  async findById(tenantId: string, id: string) {
    const [conversation] = await this.database
      .select()
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.tenantId, tenantId),
          eq(whatsappConversations.id, id)
        )
      )
      .limit(1);
    return conversation ?? null;
  }

  async upsertOpenByContact(data: UpsertOpenConversationInput) {
    const [conversation] = await this.database
      .insert(whatsappConversations)
      .values({ ...data, status: "open" })
      .onConflictDoUpdate({
        target: [
          whatsappConversations.tenantId,
          whatsappConversations.contactId,
        ],
        set: {
          status: "open",
          lastMessageAt: data.lastMessageAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return conversation;
  }

  async listByTenant(tenantId: string) {
    return this.database
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.tenantId, tenantId))
      .orderBy(desc(whatsappConversations.lastMessageAt));
  }
}
