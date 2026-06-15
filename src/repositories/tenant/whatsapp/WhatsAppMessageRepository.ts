import { and, asc, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import {
  whatsappMessages,
  type WhatsAppMessageRow,
} from "../../../db/schema/index.js";
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

  /**
   * Histórico COMPLETO da conversa (ASC), tenant-scoped. Usado por fluxos que
   * precisam de todas as mensagens (ex.: auto-reply do worker). O inbox usa a
   * versão paginada/bounded abaixo.
   */
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

  /**
   * Página de mensagens da conversa (cursor por `(createdAt, id)`), tenant-scoped.
   * Sem `before`: as `limit` mais recentes. Com `before`: as `limit` mais antigas
   * que o cursor. Busca DESC + `limit + 1` (para `hasMore`) e devolve ASC.
   */
  async findPageByConversationId(
    tenantId: string,
    conversationId: string,
    options: { limit: number; before?: { createdAtMs: number; id: string } | null }
  ): Promise<{ items: WhatsAppMessageRow[]; hasMore: boolean }> {
    const { limit, before } = options;

    const conditions = [
      eq(whatsappMessages.tenantId, tenantId),
      eq(whatsappMessages.conversationId, conversationId),
    ];

    if (before) {
      const cursorDate = new Date(before.createdAtMs);
      conditions.push(
        or(
          lt(whatsappMessages.createdAt, cursorDate),
          and(
            eq(whatsappMessages.createdAt, cursorDate),
            lt(whatsappMessages.id, before.id)
          )
        )!
      );
    }

    const rows = await this.database
      .select()
      .from(whatsappMessages)
      .where(and(...conditions))
      .orderBy(desc(whatsappMessages.createdAt), desc(whatsappMessages.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // DESC → reverte para ASC (ordem cronológica de renderização).
    page.reverse();

    return { items: page, hasMore };
  }

  /**
   * Últimas `limit` mensagens da conversa em ordem ASC (contexto de IA).
   * Reusa a query paginada sem cursor; descarta `hasMore`.
   */
  async findRecentByConversationId(
    tenantId: string,
    conversationId: string,
    limit: number
  ): Promise<WhatsAppMessageRow[]> {
    const { items } = await this.findPageByConversationId(tenantId, conversationId, {
      limit,
    });
    return items;
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
