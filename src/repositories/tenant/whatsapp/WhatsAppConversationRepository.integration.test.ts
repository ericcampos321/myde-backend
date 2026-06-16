import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../../db/client.js";
import {
  conversationReadStates,
  tenants,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from "../../../db/schema/index.js";
import {
  WhatsAppContactRepository,
  WhatsAppConversationRepository,
  WhatsAppTenantRepository,
} from "./index.js";

/**
 * Integração do read model da listagem (A-01): valida que
 * `listConversationSummaries` resolve preview + unread + última inbound numa única
 * query SQL, com a MESMA semântica do cálculo anterior em memória — sem carregar
 * todas as mensagens do tenant. Gated por RUN_DB_TESTS (precisa de Postgres migrado).
 */
const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const marker = `conversation-summaries-test-${Date.now()}`;
let sequence = 0;
const createdTenantIds: string[] = [];

const tenantRepository = new WhatsAppTenantRepository();
const contactRepository = new WhatsAppContactRepository();
const conversationRepository = new WhatsAppConversationRepository();

async function createTenant() {
  const tenant = await tenantRepository.create({
    name: "Conversation Summaries Test",
    phoneNumberId: `${marker}-${sequence++}`,
    wabaId: "WABA_CONV_SUMMARY_TEST",
  });
  expect(tenant).toBeDefined();
  createdTenantIds.push(tenant!.id);
  return tenant!;
}

async function createConversation(tenantId: string, lastMessageAt: Date | null) {
  const contact = await contactRepository.upsertByPhone({
    tenantId,
    phone: `55119${String(sequence++).padStart(8, "0")}`,
    name: "Contato Resumo",
  });
  const conversation = await conversationRepository.upsertOpenByContact({
    tenantId,
    contactId: contact!.id,
    lastMessageAt,
  });
  return { contact: contact!, conversation: conversation! };
}

async function insertMessage(params: {
  tenantId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  createdAt: Date;
}) {
  const [message] = await db
    .insert(whatsappMessages)
    .values({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      direction: params.direction,
      body: params.body,
      status: params.status,
      createdAt: params.createdAt,
    })
    .returning();
  return message!;
}

afterAll(async () => {
  if (!runDatabaseTests) return;

  for (const tenantId of createdTenantIds) {
    await db
      .delete(conversationReadStates)
      .where(eq(conversationReadStates.tenantId, tenantId));
    await db.delete(whatsappMessages).where(eq(whatsappMessages.tenantId, tenantId));
    await db
      .delete(whatsappConversations)
      .where(eq(whatsappConversations.tenantId, tenantId));
    await db.delete(whatsappContacts).where(eq(whatsappContacts.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }

  await closeDb();
});

describeDatabase("WhatsAppConversationRepository.listConversationSummaries", () => {
  it("monta preview/unread/lastInbound numa query, tenant-scoped e ordenado", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    // conv1: inbound t1, outbound t2, inbound t3; read state entre t2 e t3.
    const conv1 = await createConversation(
      tenantA.id,
      new Date("2026-06-12T12:00:00.000Z")
    );
    await insertMessage({
      tenantId: tenantA.id,
      conversationId: conv1.conversation.id,
      direction: "inbound",
      body: "Primeira inbound",
      status: "received",
      createdAt: new Date("2026-06-12T10:00:00.000Z"),
    });
    await insertMessage({
      tenantId: tenantA.id,
      conversationId: conv1.conversation.id,
      direction: "outbound",
      body: "Resposta",
      status: "sent",
      createdAt: new Date("2026-06-12T11:00:00.000Z"),
    });
    const conv1LastInbound = await insertMessage({
      tenantId: tenantA.id,
      conversationId: conv1.conversation.id,
      direction: "inbound",
      body: "Nova inbound",
      status: "received",
      createdAt: new Date("2026-06-12T12:00:00.000Z"),
    });
    await db.insert(conversationReadStates).values({
      tenantId: tenantA.id,
      conversationId: conv1.conversation.id,
      operatorId: "operator-1",
      lastReadAt: new Date("2026-06-12T11:30:00.000Z"),
      lastReadMessageId: null,
    });

    // conv2: uma inbound, SEM read state → toda inbound conta como não lida.
    const conv2 = await createConversation(
      tenantA.id,
      new Date("2026-06-12T11:00:00.000Z")
    );
    await insertMessage({
      tenantId: tenantA.id,
      conversationId: conv2.conversation.id,
      direction: "inbound",
      body: "Oi sozinha",
      status: "received",
      createdAt: new Date("2026-06-12T11:00:00.000Z"),
    });

    // conv3: SEM mensagens → preview padrão, unread 0, lastInbound null.
    const conv3 = await createConversation(
      tenantA.id,
      new Date("2026-06-12T09:00:00.000Z")
    );

    // Tenant B com mensagem — NÃO deve aparecer nos resumos do tenant A.
    const convB = await createConversation(
      tenantB.id,
      new Date("2026-06-12T13:00:00.000Z")
    );
    await insertMessage({
      tenantId: tenantB.id,
      conversationId: convB.conversation.id,
      direction: "inbound",
      body: "Mensagem de outro tenant",
      status: "received",
      createdAt: new Date("2026-06-12T13:00:00.000Z"),
    });

    const summaries = await conversationRepository.listConversationSummaries(
      tenantA.id,
      "operator-1"
    );

    // Tenant isolation: só as 3 conversas do tenant A.
    expect(summaries).toHaveLength(3);
    // Ordenação por last_message_at desc.
    expect(summaries.map((s) => s.id)).toEqual([
      conv1.conversation.id,
      conv2.conversation.id,
      conv3.conversation.id,
    ]);

    const s1 = summaries[0]!;
    expect(s1.contactName).toBe("Contato Resumo");
    expect(s1.contactPhone).toBe(conv1.contact.phone);
    expect(s1.lastMessageBody).toBe("Nova inbound");
    expect(s1.lastMessageDirection).toBe("inbound");
    // unread = só a inbound após o lastReadAt (t3), não a t1.
    expect(s1.unreadCount).toBe(1);
    expect(s1.lastInboundMessageId).toBe(conv1LastInbound.id);
    expect(s1.lastInboundMessageAt?.toISOString()).toBe(
      "2026-06-12T12:00:00.000Z"
    );

    const s2 = summaries[1]!;
    expect(s2.lastMessageBody).toBe("Oi sozinha");
    expect(s2.lastMessageDirection).toBe("inbound");
    // Sem read state: a inbound conta como não lida.
    expect(s2.unreadCount).toBe(1);

    const s3 = summaries[2]!;
    expect(s3.lastMessageBody).toBeNull();
    expect(s3.lastMessageDirection).toBeNull();
    expect(s3.lastInboundMessageId).toBeNull();
    expect(s3.unreadCount).toBe(0);

    // Outro operador (sem read state em conv1) enxerga as 2 inbound como não lidas.
    const summariesOperator2 =
      await conversationRepository.listConversationSummaries(
        tenantA.id,
        "operator-2"
      );
    const conv1ForOperator2 = summariesOperator2.find(
      (s) => s.id === conv1.conversation.id
    );
    expect(conv1ForOperator2?.unreadCount).toBe(2);
  });
});
