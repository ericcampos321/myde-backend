import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, type Database } from "../../db/client.js";
import { whatsappMessages } from "../../db/schema.js";
import type {
  CreateInboundMessageInput,
  CreateOutboundMessageInput,
} from "./WhatsAppMessageTypes.js";

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
