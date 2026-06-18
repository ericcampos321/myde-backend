import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import { inboxRecentSearches } from "../../../db/schema/index.js";

export type InboxRecentSearchTargetType = "conversation" | "contact";

interface SaveRecentSearchInput {
  tenantId: string;
  operatorId: string;
  targetType: InboxRecentSearchTargetType;
  targetId: string;
}

export class InboxRecentSearchRepository {
  constructor(private readonly database: Database = db) {}

  async listByOperator(tenantId: string, operatorId: string, limit = 4) {
    return this.database
      .select()
      .from(inboxRecentSearches)
      .where(
        and(
          eq(inboxRecentSearches.tenantId, tenantId),
          eq(inboxRecentSearches.operatorId, operatorId)
        )
      )
      .orderBy(desc(inboxRecentSearches.updatedAt))
      .limit(limit);
  }

  async saveAndTrim(input: SaveRecentSearchInput, limit = 4) {
    return this.database.transaction(async (tx) => {
      const now = new Date();
      const [saved] = await tx
        .insert(inboxRecentSearches)
        .values({ ...input, updatedAt: now })
        .onConflictDoUpdate({
          target: [
            inboxRecentSearches.tenantId,
            inboxRecentSearches.operatorId,
            inboxRecentSearches.targetType,
            inboxRecentSearches.targetId,
          ],
          set: { updatedAt: now },
        })
        .returning();

      const recentRows = await tx
        .select({ id: inboxRecentSearches.id })
        .from(inboxRecentSearches)
        .where(
          and(
            eq(inboxRecentSearches.tenantId, input.tenantId),
            eq(inboxRecentSearches.operatorId, input.operatorId)
          )
        )
        .orderBy(desc(inboxRecentSearches.updatedAt))
        .offset(limit);

      if (recentRows.length > 0) {
        await tx
          .delete(inboxRecentSearches)
          .where(inArray(inboxRecentSearches.id, recentRows.map((row) => row.id)));
      }

      return saved;
    });
  }

  async clearByOperator(tenantId: string, operatorId: string) {
    await this.database
      .delete(inboxRecentSearches)
      .where(
        and(
          eq(inboxRecentSearches.tenantId, tenantId),
          eq(inboxRecentSearches.operatorId, operatorId)
        )
      );
  }
}
