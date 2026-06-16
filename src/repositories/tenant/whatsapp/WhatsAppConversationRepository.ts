import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Database } from "../../../db/client.js";
import { whatsappConversations } from "../../../db/schema/index.js";
import type {
  ConversationSummaryRow,
  UpsertOpenConversationInput,
} from "../../../types/tenant/whatsapp/WhatsAppConversationTypes.js";

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

  async findByContactId(tenantId: string, contactId: string) {
    const [conversation] = await this.database
      .select()
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.tenantId, tenantId),
          eq(whatsappConversations.contactId, contactId)
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

  /**
   * Read model da listagem do inbox (GET /conversations) em UMA query — corrige o
   * achado A-01 (antes o serviço carregava TODAS as mensagens do tenant em memória
   * para montar preview/unread). Tudo é resolvido no Postgres:
   *
   * - `latest_messages`: última mensagem por conversa via `DISTINCT ON
   *   (conversation_id)` ordenado por `created_at DESC, id DESC` → preview
   *   (body/direction/status). Usa o índice
   *   `whatsapp_messages_tenant_conversation_created_idx`.
   * - `latest_inbound`: última inbound por conversa (para `lastInboundMessageId/At`).
   * - `unread_counts`: COUNT de inbound não lidas por conversa, fazendo LEFT JOIN
   *   com `conversation_read_states` do operador (inbound sem read state OU com
   *   `created_at > last_read_at`) — mesma regra do cálculo anterior em memória.
   *
   * Tenant isolation: `tenant_id = ${tenantId}` em todas as CTEs e na query final;
   * o join de contato amarra `tenant_id`. `tenantId`/`operatorId` são SEMPRE
   * parametrizados (bind), nunca concatenados. Ordenação idêntica à `listByTenant`
   * (`last_message_at DESC`, NULLS FIRST do Postgres), com `id DESC` de desempate
   * determinístico.
   */
  async listConversationSummaries(
    tenantId: string,
    operatorId: string
  ): Promise<ConversationSummaryRow[]> {
    const result = await this.database.execute(sql`
      WITH latest_messages AS (
        SELECT DISTINCT ON (m.conversation_id)
          m.conversation_id,
          m.body,
          m.direction,
          m.status
        FROM whatsapp_messages m
        WHERE m.tenant_id = ${tenantId}
        ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
      ),
      latest_inbound AS (
        SELECT DISTINCT ON (m.conversation_id)
          m.conversation_id,
          m.id,
          m.created_at
        FROM whatsapp_messages m
        WHERE m.tenant_id = ${tenantId}
          AND m.direction = 'inbound'
        ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
      ),
      unread_counts AS (
        SELECT
          m.conversation_id,
          COUNT(*)::int AS unread_count
        FROM whatsapp_messages m
        LEFT JOIN conversation_read_states r
          ON r.tenant_id = m.tenant_id
         AND r.conversation_id = m.conversation_id
         AND r.operator_id = ${operatorId}
        WHERE m.tenant_id = ${tenantId}
          AND m.direction = 'inbound'
          AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
        GROUP BY m.conversation_id
      )
      SELECT
        c.id                          AS "id",
        c.contact_id                  AS "contactId",
        c.status                      AS "status",
        c.last_message_at             AS "lastMessageAt",
        c.created_at                  AS "createdAt",
        ct.name                       AS "contactName",
        ct.phone                      AS "contactPhone",
        lm.body                       AS "lastMessageBody",
        lm.direction                  AS "lastMessageDirection",
        lm.status                     AS "lastMessageStatus",
        li.id                         AS "lastInboundMessageId",
        li.created_at                 AS "lastInboundMessageAt",
        COALESCE(uc.unread_count, 0)  AS "unreadCount"
      FROM whatsapp_conversations c
      LEFT JOIN whatsapp_contacts ct
        ON ct.id = c.contact_id AND ct.tenant_id = c.tenant_id
      LEFT JOIN latest_messages lm ON lm.conversation_id = c.id
      LEFT JOIN latest_inbound li ON li.conversation_id = c.id
      LEFT JOIN unread_counts uc ON uc.conversation_id = c.id
      WHERE c.tenant_id = ${tenantId}
      ORDER BY c.last_message_at DESC, c.id DESC
    `);

    // `db.execute` (SQL cru) NÃO aplica o parsing de tipos do Drizzle: timestamps
    // voltam como string e a contagem pode vir como string. Normalizamos aqui para
    // honrar o tipo declarado (Date/number) — o service depende disso (.toISOString()).
    const rows = result as unknown as RawConversationSummaryRow[];
    return rows.map((row) => ({
      id: row.id,
      contactId: row.contactId,
      status: row.status,
      lastMessageAt: toDateOrNull(row.lastMessageAt),
      createdAt: toDateOrNull(row.createdAt) ?? new Date(0),
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      lastMessageBody: row.lastMessageBody,
      lastMessageDirection: row.lastMessageDirection,
      lastMessageStatus: row.lastMessageStatus,
      lastInboundMessageId: row.lastInboundMessageId,
      lastInboundMessageAt: toDateOrNull(row.lastInboundMessageAt),
      unreadCount: Number(row.unreadCount ?? 0),
    }));
  }
}

/** Forma crua de uma linha do read model antes da normalização de tipos. */
interface RawConversationSummaryRow {
  id: string;
  contactId: string;
  status: string;
  lastMessageAt: string | Date | null;
  createdAt: string | Date | null;
  contactName: string | null;
  contactPhone: string | null;
  lastMessageBody: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageStatus: string | null;
  lastInboundMessageId: string | null;
  lastInboundMessageAt: string | Date | null;
  unreadCount: number | string | null;
}

function toDateOrNull(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}
