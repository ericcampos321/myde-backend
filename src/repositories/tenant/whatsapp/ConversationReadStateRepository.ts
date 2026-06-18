import { and, eq, inArray } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import { conversationReadStates } from "../../../db/schema/index.js";

interface UpsertConversationReadStateInput {
  tenantId: string;
  conversationId: string;
  operatorId: string;
  lastReadAt: Date;
  lastReadMessageId: string | null;
}

export class ConversationReadStateRepository {
  constructor(private readonly database: Database = db) {}

  async findByConversationIds(
    tenantId: string,
    operatorId: string,
    conversationIds: string[]
  ) {
    if (conversationIds.length === 0) {
      return [];
    }

    return this.database
      .select()
      .from(conversationReadStates)
      .where(
        and(
          eq(conversationReadStates.tenantId, tenantId),
          eq(conversationReadStates.operatorId, operatorId),
          inArray(conversationReadStates.conversationId, conversationIds)
        )
      );
  }

  async findByConversationId(
    tenantId: string,
    operatorId: string,
    conversationId: string
  ) {
    const [state] = await this.database
      .select()
      .from(conversationReadStates)
      .where(
        and(
          eq(conversationReadStates.tenantId, tenantId),
          eq(conversationReadStates.operatorId, operatorId),
          eq(conversationReadStates.conversationId, conversationId)
        )
      )
      .limit(1);

    return state ?? null;
  }

  async upsert(input: UpsertConversationReadStateInput) {
    const [state] = await this.database
      .insert(conversationReadStates)
      .values(input)
      .onConflictDoUpdate({
        target: [
          conversationReadStates.tenantId,
          conversationReadStates.conversationId,
          conversationReadStates.operatorId,
        ],
        set: {
          lastReadAt: input.lastReadAt,
          lastReadMessageId: input.lastReadMessageId,
          updatedAt: new Date(),
        },
      })
      .returning();

    return state;
  }
}
