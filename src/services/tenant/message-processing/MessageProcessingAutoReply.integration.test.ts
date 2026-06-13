import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../../../config/env.js";
import * as schema from "../../../db/schema/index.js";
import {
  tenants,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from "../../../db/schema/index.js";
import {
  WhatsAppOutboundService,
  type MetaOutboundClient,
} from "../whatsapp/WhatsAppOutboundService.js";
import { createMessageProcessingProcessor } from "./MessageProcessingProcessor.js";

/**
 * E2E (sem HTTP, sem rede): inbound persistido → processor com IA fake → outbound
 * REAL (WhatsAppOutboundService) com cliente Meta fake → persiste outbound com
 * replyToMessageId. Não chama OpenAI real nem Meta real. Cobre o caminho do
 * worker quando WHATSAPP_AUTO_REPLY_ENABLED=true.
 */
const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const describeDatabase = runDatabaseTests ? describe : describe.skip;

const marker = `autoreply-e2e-${Date.now()}`;
const sql = postgres(env.DATABASE_URL, { max: 2 });
const database = drizzle(sql, { schema });

let tenantId = "";
let conversationId = "";
let inboundId = "";

const metaCalls: Array<{ phoneNumberId: string; to: string; body: string }> = [];
const fakeMeta: MetaOutboundClient = {
  async sendText(params) {
    metaCalls.push(params);
    return { externalMessageId: `${marker}-out-wamid` };
  },
};

describeDatabase("auto-reply E2E (inbound → worker → outbound)", () => {
  beforeAll(async () => {
    const [tenant] = await database
      .insert(tenants)
      .values({
        name: "AutoReply E2E Tenant",
        phoneNumberId: `${marker}-phone`,
        wabaId: `${marker}-waba`,
      })
      .returning();
    tenantId = tenant!.id;

    const [contact] = await database
      .insert(whatsappContacts)
      .values({ tenantId, phone: "5511966665555", name: "Cliente E2E" })
      .returning();

    const [conversation] = await database
      .insert(whatsappConversations)
      .values({ tenantId, contactId: contact!.id, status: "open" })
      .returning();
    conversationId = conversation!.id;

    const [inbound] = await database
      .insert(whatsappMessages)
      .values({
        tenantId,
        conversationId,
        direction: "inbound",
        body: "quais planos voces tem?",
        status: "received",
        externalMessageId: `${marker}-in-wamid`,
      })
      .returning();
    inboundId = inbound!.id;
  });

  afterAll(async () => {
    await database
      .delete(whatsappMessages)
      .where(eq(whatsappMessages.tenantId, tenantId));
    await database
      .delete(whatsappConversations)
      .where(eq(whatsappConversations.tenantId, tenantId));
    await database
      .delete(whatsappContacts)
      .where(eq(whatsappContacts.tenantId, tenantId));
    await database.delete(tenants).where(eq(tenants.id, tenantId));
    await sql.end({ timeout: 5 });
  });

  it("processa inbound e envia/persiste a resposta outbound com replyToMessageId", async () => {
    const outboundService = new WhatsAppOutboundService({ metaClient: fakeMeta });
    const processor = createMessageProcessingProcessor({
      autoReplyEnabled: true,
      outboundService,
      aiResponseService: {
        generateResponse: async () => ({
          text: "Temos o Fibra 300 por R$ 79,90.",
          source: "stub",
        }),
      },
    });

    const result = await processor.processMessageJob({
      tenantId,
      conversationId,
      messageId: inboundId,
      externalMessageId: `${marker}-in-wamid`,
      phoneNumberId: `${marker}-phone`,
      contactPhone: "5511966665555",
      displayPhoneNumber: `${marker}-display`,
    });

    expect(result.processed).toBe(true);

    // Meta chamada uma vez, com o phoneNumberId do tenant.
    expect(metaCalls).toHaveLength(1);
    expect(metaCalls[0]).toMatchObject({
      phoneNumberId: `${marker}-phone`,
      to: "5511966665555",
      body: "Temos o Fibra 300 por R$ 79,90.",
    });

    // Outbound persistida, amarrada ao inbound (replyToMessageId).
    const [outbound] = await database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.replyToMessageId, inboundId)
        )
      );

    expect(outbound?.direction).toBe("outbound");
    expect(outbound?.status).toBe("sent");
    expect(outbound?.body).toBe("Temos o Fibra 300 por R$ 79,90.");
    expect(outbound?.externalMessageId).toBe(`${marker}-out-wamid`);
  });
});
