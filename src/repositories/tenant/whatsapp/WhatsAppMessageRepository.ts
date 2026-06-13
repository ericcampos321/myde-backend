import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import { whatsappMessages } from "../../../db/schema/index.js";
import type {
  CreateInboundMessageInput,
  CreateOutboundMessageInput,
} from "../../../types/tenant/whatsapp/WhatsAppMessageTypes.js";

export class WhatsAppMessageRepository {
  constructor(private readonly database: Database = db) {}

  async findById(tenantId: string, id: string) {
    const [message] = await this.database
      .select()
      .from(whatsappMessages)
      .where(
        and(eq(whatsappMessages.tenantId, tenantId), eq(whatsappMessages.id, id))
      )
      .limit(1);
    return message ?? null;
  }

  async findByExternalMessageId(tenantId: string, externalMessageId: string) {
    const [message] = await this.database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.externalMessageId, externalMessageId)
        )
      )
      .limit(1);
    return message ?? null;
  }

  async createInbound(data: CreateInboundMessageInput) {
    const [message] = await this.database
      .insert(whatsappMessages)
      .values({
        ...data,
        direction: "inbound",
        status: "received",
      })
      .onConflictDoNothing({
        target: [whatsappMessages.tenantId, whatsappMessages.externalMessageId],
        where: isNotNull(whatsappMessages.externalMessageId),
      })
      .returning();
    return message;
  }

  async createOutbound(data: CreateOutboundMessageInput) {
    const [message] = await this.database
      .insert(whatsappMessages)
      .values({
        ...data,
        direction: "outbound",
      })
      .returning();
    return message;
  }

  async findByConversationId(tenantId: string, conversationId: string) {
    return this.database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.conversationId, conversationId)
        )
      )
      .orderBy(asc(whatsappMessages.createdAt));
  }

  async findLatestByConversationId(tenantId: string, conversationId: string) {
    const [message] = await this.database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.conversationId, conversationId)
        )
      )
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(1);

    return message ?? null;
  }

  async findLatestInboundByConversationId(tenantId: string, conversationId: string) {
    const [message] = await this.database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.conversationId, conversationId),
          eq(whatsappMessages.direction, "inbound")
        )
      )
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(1);

    return message ?? null;
  }

  async findByConversationIds(tenantId: string, conversationIds: string[]) {
    if (conversationIds.length === 0) {
      return [];
    }

    return this.database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          inArray(whatsappMessages.conversationId, conversationIds)
        )
      )
      .orderBy(asc(whatsappMessages.createdAt));
  }

  /**
   * Atualiza o status de uma mensagem outbound pelo externalMessageId (wamid),
   * tenant-scoped. Quando status="failed", grava também o motivo da Meta
   * (failureCode/failureReason/failedAt). Retorna a row atualizada ou null.
   */
  async updateStatusByExternalMessageId(
    tenantId: string,
    externalMessageId: string,
    status: string,
    failure?: { code: number | null; reason: string | null }
  ) {
    const isFailed = status === "failed";
    const [message] = await this.database
      .update(whatsappMessages)
      .set({
        status,
        updatedAt: new Date(),
        // Só popula campos de falha quando failed; senão limpa (ex.: re-tentativa).
        failureCode: isFailed ? (failure?.code ?? null) : null,
        failureReason: isFailed ? (failure?.reason ?? null) : null,
        failedAt: isFailed ? new Date() : null,
      })
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.externalMessageId, externalMessageId)
        )
      )
      .returning();
    return message ?? null;
  }

  async findOutboundByReplyToMessageId(
    tenantId: string,
    replyToMessageId: string
  ) {
    const [message] = await this.database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.direction, "outbound"),
          eq(whatsappMessages.replyToMessageId, replyToMessageId)
        )
      )
      .limit(1);
    return message ?? null;
  }
}
