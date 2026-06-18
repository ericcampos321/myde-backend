import { eq, and } from "drizzle-orm";
import { db } from "../../../db/client.js";
import {
  tenants,
  type TenantRow,
} from "../../../db/schema/tenant/tenants.schema.js";
import {
  whatsappConversations,
  type WhatsAppConversationRow,
} from "../../../db/schema/whatsapp/whatsappConversations.schema.js";
import {
  whatsappContacts,
  type WhatsAppContactRow,
} from "../../../db/schema/whatsapp/whatsappContacts.schema.js";
import {
  whatsappMessages,
  type WhatsAppMessageRow,
  type NewWhatsAppMessageRow,
} from "../../../db/schema/whatsapp/whatsappMessages.schema.js";
import { AppError } from "../../../errors/AppError.js";
import { createLogger } from "../../../shared/logger/logger.js";
import { MetaGraphApiClient } from "../../../clients/meta/MetaGraphApiClient.js";
import { TenantAccessPolicy } from "../../../policies/tenant/TenantAccessPolicy.js";

const log = createLogger({ module: "whatsapp-outbound" });

const MAX_MESSAGE_LENGTH = 4096;

/** Contrato mínimo do cliente Meta usado pelo serviço (facilita injeção em teste). */
export interface MetaOutboundClient {
  sendText(params: {
    phoneNumberId: string;
    to: string;
    body: string;
  }): Promise<{ externalMessageId: string }>;
}

export interface WhatsAppOutboundServiceDependencies {
  metaClient?: MetaOutboundClient;
}

export interface SendMessageInput {
  tenantId: string;
  conversationId: string;
  text: string;
  /**
   * Quando presente (ex.: auto-reply do worker), amarra a mensagem outbound à
   * mensagem inbound que a originou. Serve de chave de idempotência: o índice
   * único (tenantId, replyToMessageId) garante uma única resposta por inbound,
   * e checamos a existência ANTES de chamar a Meta para não enviar duplicado em
   * retry. O fluxo manual do composer não envia este campo.
   */
  replyToMessageId?: string;
}

export interface SendMessageOutput {
  id: string;
  conversationId: string;
  direction: "outbound";
  body: string;
  status: string;
  externalMessageId: string | null;
  createdAt: Date;
}

export class WhatsAppOutboundService {
  private metaClient: MetaOutboundClient;

  constructor(dependencies: WhatsAppOutboundServiceDependencies = {}) {
    this.metaClient = dependencies.metaClient ?? new MetaGraphApiClient();
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageOutput> {
    TenantAccessPolicy.assertTenantId(input.tenantId);

    if (!input.conversationId) {
      throw new AppError({
        code: "CONVERSATION_ID_REQUIRED",
        message: "conversationId é obrigatório",
        statusCode: 400,
      });
    }

    const text = input.text?.trim() || "";
    if (!text) {
      throw new AppError({
        code: "MESSAGE_TEXT_REQUIRED",
        message: "Mensagem não pode estar vazia",
        statusCode: 400,
      });
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new AppError({
        code: "MESSAGE_TEXT_TOO_LONG",
        message: `Mensagem não pode exceder ${MAX_MESSAGE_LENGTH} caracteres`,
        statusCode: 400,
      });
    }

    // Resolve o tenant pelo id do header. Garante que o X-Tenant-ID corresponde
    // a um tenant real e fornece o phoneNumberId correto para envio (multi-tenant).
    const tenant = await this.getTenant(input.tenantId);
    if (!tenant) {
      throw new AppError({
        code: "TENANT_NOT_FOUND",
        message: "Tenant não encontrado",
        statusCode: 404,
      });
    }

    const conversation = await this.getConversation(
      tenant.id,
      input.conversationId
    );
    if (!conversation) {
      throw new AppError({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversa não encontrada",
        statusCode: 404,
      });
    }

    const contact = await this.getContact(tenant.id, conversation.contactId);
    if (!contact) {
      throw new AppError({
        code: "CONTACT_NOT_FOUND",
        message: "Contato da conversa não encontrado",
        statusCode: 404,
      });
    }

    if (!contact.phone) {
      throw new AppError({
        code: "CONTACT_PHONE_MISSING",
        message: "Contato não possui telefone configurado",
        statusCode: 400,
      });
    }

    // Idempotência (auto-reply): se já existe uma outbound respondendo a este
    // inbound, NÃO reenvia à Meta — retorna a resposta já enviada. Cobre retry
    // de job com o mesmo replyToMessageId sem mandar mensagem duplicada.
    if (input.replyToMessageId) {
      const existing = await this.findReplyOutbound(
        tenant.id,
        input.replyToMessageId
      );
      if (existing) {
        log.info(
          {
            tenantId: tenant.id,
            conversationId: input.conversationId,
            replyToMessageId: input.replyToMessageId,
          },
          "[outbound] auto-reply já enviado — ignorando (idempotente)"
        );
        return this.toOutput(existing);
      }
    }

    log.info(
      {
        tenantId: tenant.id,
        conversationId: input.conversationId,
        contactId: contact.id,
        textLength: text.length,
        autoReply: Boolean(input.replyToMessageId),
      },
      "[outbound] sending message via Meta"
    );

    // Estratégia: Meta primeiro. Só persistimos como `sent` se a Meta aceitar;
    // se a Meta falhar, o erro sobe e nenhuma mensagem falsa é criada.
    let externalMessageId: string | null = null;
    try {
      const result = await this.metaClient.sendText({
        phoneNumberId: tenant.phoneNumberId,
        to: contact.phone,
        body: text,
      });
      externalMessageId = result.externalMessageId;
    } catch (error) {
      log.error(
        {
          tenantId: tenant.id,
          conversationId: input.conversationId,
          contactId: contact.id,
          error: error instanceof Error ? error.message : "unknown",
        },
        "[outbound] Meta send failed"
      );
      throw error;
    }

    const message = await this.persistOutboundMessage({
      tenantId: tenant.id,
      conversationId: input.conversationId,
      body: text,
      externalMessageId,
      replyToMessageId: input.replyToMessageId ?? null,
    });

    await this.updateConversationLastMessage(tenant.id, input.conversationId);

    return this.toOutput(message);
  }

  private toOutput(message: WhatsAppMessageRow): SendMessageOutput {
    return {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction as "outbound",
      body: message.body,
      status: message.status,
      externalMessageId: message.externalMessageId,
      createdAt: message.createdAt,
    };
  }

  /** Procura uma outbound já enviada como resposta a um inbound (idempotência). */
  private async findReplyOutbound(
    tenantId: string,
    replyToMessageId: string
  ): Promise<WhatsAppMessageRow | null> {
    const result = await db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.replyToMessageId, replyToMessageId)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  private async getTenant(tenantId: string): Promise<TenantRow | null> {
    const result = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    return result[0] ?? null;
  }

  private async getConversation(
    tenantId: string,
    conversationId: string
  ): Promise<WhatsAppConversationRow | null> {
    const result = await db
      .select()
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.id, conversationId),
          eq(whatsappConversations.tenantId, tenantId)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  private async getContact(
    tenantId: string,
    contactId: string
  ): Promise<WhatsAppContactRow | null> {
    const result = await db
      .select()
      .from(whatsappContacts)
      .where(
        and(
          eq(whatsappContacts.id, contactId),
          eq(whatsappContacts.tenantId, tenantId)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  private async persistOutboundMessage(params: {
    tenantId: string;
    conversationId: string;
    body: string;
    externalMessageId: string | null;
    replyToMessageId: string | null;
  }): Promise<WhatsAppMessageRow> {
    const newMessage: NewWhatsAppMessageRow = {
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      direction: "outbound",
      body: params.body,
      status: "sent",
      externalMessageId: params.externalMessageId,
      replyToMessageId: params.replyToMessageId,
    };

    const result = await db
      .insert(whatsappMessages)
      .values(newMessage)
      .returning();

    if (!result[0]) {
      throw new AppError({
        code: "MESSAGE_PERSISTENCE_FAILED",
        message: "Falha ao persistir mensagem no banco",
        statusCode: 500,
      });
    }

    return result[0];
  }

  private async updateConversationLastMessage(
    tenantId: string,
    conversationId: string
  ): Promise<void> {
    await db
      .update(whatsappConversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappConversations.id, conversationId),
          eq(whatsappConversations.tenantId, tenantId)
        )
      );
  }
}

export function createWhatsAppOutboundService(): WhatsAppOutboundService {
  return new WhatsAppOutboundService();
}