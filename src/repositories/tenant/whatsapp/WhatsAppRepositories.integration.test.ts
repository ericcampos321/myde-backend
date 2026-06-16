import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { closeDb, db } from "../../../db/client.js";
import {
  inboxRecentSearches,
  tenants,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from "../../../db/schema/index.js";
import { WhatsAppContactRepository } from "./index.js";
import { WhatsAppConversationRepository } from "./index.js";
import { WhatsAppMessageRepository } from "./index.js";
import { WhatsAppTenantRepository } from "./index.js";
import { InboxRecentSearchRepository } from "./index.js";
import { escapeLikeSearchTerm } from "../../../services/api/inbox/inboxMessageSearch.js";

function ilikePattern(term: string): string {
  return `%${escapeLikeSearchTerm(term)}%`;
}

const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const marker = `repository-test-${Date.now()}`;
let sequence = 0;
const createdTenantIds: string[] = [];

const tenantRepository = new WhatsAppTenantRepository();
const contactRepository = new WhatsAppContactRepository();
const conversationRepository = new WhatsAppConversationRepository();
const messageRepository = new WhatsAppMessageRepository();
const recentSearchRepository = new InboxRecentSearchRepository();

async function createTenant() {
  const tenant = await tenantRepository.create({
    name: "Repository Test",
    phoneNumberId: `${marker}-${sequence++}`,
    wabaId: "WABA_REPOSITORY_TEST",
  });
  expect(tenant).toBeDefined();
  createdTenantIds.push(tenant!.id);
  return tenant!;
}

async function createConversation() {
  const tenant = await createTenant();
  const contact = await contactRepository.upsertByPhone({
    tenantId: tenant.id,
    phone: "5511999990000",
    name: "Cliente Teste",
  });
  const conversation = await conversationRepository.upsertOpenByContact({
    tenantId: tenant.id,
    contactId: contact!.id,
    lastMessageAt: new Date(),
  });
  return { tenant, contact: contact!, conversation: conversation! };
}

afterAll(async () => {
  if (!runDatabaseTests) return;

  for (const tenantId of createdTenantIds) {
    await db
      .delete(inboxRecentSearches)
      .where(eq(inboxRecentSearches.tenantId, tenantId));
    await db.delete(whatsappMessages).where(eq(whatsappMessages.tenantId, tenantId));
    await db
      .delete(whatsappConversations)
      .where(eq(whatsappConversations.tenantId, tenantId));
    await db
      .delete(whatsappContacts)
      .where(eq(whatsappContacts.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
  await closeDb();
});

describeDatabase("repositories com PostgreSQL", () => {
  it("faz upsert idempotente de tenant por phoneNumberId", async () => {
    const phoneNumberId = `${marker}-${sequence++}`;
    const first = await tenantRepository.upsertByPhoneNumberId({
      name: "NeoFibra",
      phoneNumberId,
      wabaId: "WABA_TESTE_0001",
    });
    const second = await tenantRepository.upsertByPhoneNumberId({
      name: "NeoFibra Atualizada",
      phoneNumberId,
      wabaId: "WABA_TESTE_0001",
    });

    expect(second?.id).toBe(first?.id);
    expect(second?.name).toBe("NeoFibra Atualizada");
    createdTenantIds.push(first!.id);
  });

  it("faz upsert idempotente de contato por tenantId e phone", async () => {
    const tenant = await createTenant();
    const first = await contactRepository.upsertByPhone({
      tenantId: tenant.id,
      phone: "5511988880000",
      name: "Primeiro Nome",
    });
    const second = await contactRepository.upsertByPhone({
      tenantId: tenant.id,
      phone: "5511988880000",
      name: "Nome Atualizado",
    });

    expect(second?.id).toBe(first?.id);
    expect(second?.name).toBe("Nome Atualizado");
  });

  it("faz upsert idempotente de conversa por tenantId e contactId", async () => {
    const { tenant, contact, conversation } = await createConversation();
    const updated = await conversationRepository.upsertOpenByContact({
      tenantId: tenant.id,
      contactId: contact.id,
      lastMessageAt: new Date("2026-06-12T00:00:00.000Z"),
    });

    expect(updated?.id).toBe(conversation.id);
    expect(updated?.status).toBe("open");
  });

  it("recent searches faz upsert sem duplicar e mantem somente quatro", async () => {
    const tenant = await createTenant();
    const operatorId = "operator-recent-limit";
    const targetIds = Array.from({ length: 5 }, () => randomUUID());

    await recentSearchRepository.saveAndTrim({
      tenantId: tenant.id,
      operatorId,
      targetType: "conversation",
      targetId: targetIds[0]!,
    });
    await recentSearchRepository.saveAndTrim({
      tenantId: tenant.id,
      operatorId,
      targetType: "conversation",
      targetId: targetIds[0]!,
    });

    for (const targetId of targetIds.slice(1)) {
      await recentSearchRepository.saveAndTrim({
        tenantId: tenant.id,
        operatorId,
        targetType: "conversation",
        targetId,
      });
    }

    const recent = await recentSearchRepository.listByOperator(
      tenant.id,
      operatorId,
      10
    );

    expect(recent).toHaveLength(4);
    expect(new Set(recent.map((item) => item.targetId)).size).toBe(4);
    expect(recent.some((item) => item.targetId === targetIds[4])).toBe(true);
  });

  it("recent searches limpa somente o operador solicitado", async () => {
    const tenant = await createTenant();

    await recentSearchRepository.saveAndTrim({
      tenantId: tenant.id,
      operatorId: "operator-a",
      targetType: "contact",
      targetId: randomUUID(),
    });
    await recentSearchRepository.saveAndTrim({
      tenantId: tenant.id,
      operatorId: "operator-b",
      targetType: "contact",
      targetId: randomUUID(),
    });

    await recentSearchRepository.clearByOperator(tenant.id, "operator-a");

    await expect(
      recentSearchRepository.listByOperator(tenant.id, "operator-a")
    ).resolves.toEqual([]);
    await expect(
      recentSearchRepository.listByOperator(tenant.id, "operator-b")
    ).resolves.toHaveLength(1);
  });

  it("cria inbound e encontra por externalMessageId", async () => {
    const { tenant, conversation } = await createConversation();
    const message = await messageRepository.createInbound({
      tenantId: tenant.id,
      conversationId: conversation.id,
      body: "Quais sao os planos?",
      externalMessageId: `${marker}-wamid-1`,
      createdAt: new Date(),
    });
    const found = await messageRepository.findByExternalMessageId(
      tenant.id,
      `${marker}-wamid-1`
    );

    expect(found?.id).toBe(message?.id);
    expect(found?.direction).toBe("inbound");
  });

  it("evita duplicar inbound pelo mesmo externalMessageId", async () => {
    const { tenant, conversation } = await createConversation();
    const data = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      body: "Mensagem duplicada",
      externalMessageId: `${marker}-wamid-duplicate`,
      createdAt: new Date(),
    };
    const first = await messageRepository.createInbound(data);
    const duplicate = await messageRepository.createInbound(data);

    expect(first).toBeDefined();
    expect(duplicate).toBeUndefined();
  });
});

describeDatabase("travas multi-tenant no banco", () => {
  it("dois tenants podem ter o mesmo phone de contato sem conflito", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const phone = "5511900000010";

    const contactA = await contactRepository.upsertByPhone({
      tenantId: tenantA.id,
      phone,
      name: "Contato A",
    });
    const contactB = await contactRepository.upsertByPhone({
      tenantId: tenantB.id,
      phone,
      name: "Contato B",
    });

    expect(contactA?.id).toBeDefined();
    expect(contactB?.id).toBeDefined();
    expect(contactA?.id).not.toBe(contactB?.id);
  });

  it("mesmo tenant nao pode duplicar phone de contato (unique tenantId+phone)", async () => {
    const tenant = await createTenant();
    const phone = "5511900000011";

    await db
      .insert(whatsappContacts)
      .values({ tenantId: tenant.id, phone, name: "Primeiro" });

    await expect(
      db
        .insert(whatsappContacts)
        .values({ tenantId: tenant.id, phone, name: "Segundo" })
    ).rejects.toThrow();
  });

  it("dois tenants podem ter o mesmo externalMessageId sem conflito", async () => {
    const a = await createConversation();
    const b = await createConversation();
    const externalMessageId = `${marker}-shared-ext`;

    const messageA = await messageRepository.createInbound({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      body: "A",
      externalMessageId,
      createdAt: new Date(),
    });
    const messageB = await messageRepository.createInbound({
      tenantId: b.tenant.id,
      conversationId: b.conversation.id,
      body: "B",
      externalMessageId,
      createdAt: new Date(),
    });

    expect(messageA?.id).toBeDefined();
    expect(messageB?.id).toBeDefined();
    expect(messageA?.id).not.toBe(messageB?.id);
  });

  it("mesmo tenant nao pode duplicar externalMessageId (unique parcial)", async () => {
    const { tenant, conversation } = await createConversation();
    const base = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: "inbound" as const,
      body: "x",
      status: "received",
      externalMessageId: `${marker}-dup-ext`,
    };

    await db.insert(whatsappMessages).values(base);

    await expect(
      db.insert(whatsappMessages).values({ ...base })
    ).rejects.toThrow();
  });

  it("mesmo tenant nao pode duplicar replyToMessageId (unique parcial)", async () => {
    const { tenant, conversation } = await createConversation();
    const replied = await messageRepository.createInbound({
      tenantId: tenant.id,
      conversationId: conversation.id,
      body: "Pergunta",
      externalMessageId: `${marker}-reply-base`,
      createdAt: new Date(),
    });
    const outbound = {
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: "outbound" as const,
      body: "Resposta",
      status: "sent",
      replyToMessageId: replied!.id,
    };

    await db.insert(whatsappMessages).values(outbound);

    await expect(
      db.insert(whatsappMessages).values({ ...outbound })
    ).rejects.toThrow();
  });

  it("conversa do tenant A nao pode apontar para contato do tenant B (FK composta)", async () => {
    const tenantA = await createTenant();
    const b = await createConversation();

    await expect(
      db.insert(whatsappConversations).values({
        tenantId: tenantA.id,
        contactId: b.contact.id,
      })
    ).rejects.toThrow();
  });

  it("mensagem do tenant A nao pode apontar para conversa do tenant B (FK composta)", async () => {
    const tenantA = await createTenant();
    const b = await createConversation();

    await expect(
      db.insert(whatsappMessages).values({
        tenantId: tenantA.id,
        conversationId: b.conversation.id,
        direction: "inbound",
        body: "cross-tenant",
        status: "received",
        externalMessageId: `${marker}-cross-tenant`,
      })
    ).rejects.toThrow();
  });
});

describeDatabase("paginação de mensagens (findPageByConversationId)", () => {
  async function seedMessages(count: number) {
    const { tenant, conversation } = await createConversation();
    const base = Date.UTC(2026, 5, 12, 10, 0, 0);
    for (let i = 0; i < count; i += 1) {
      await messageRepository.createInbound({
        tenantId: tenant.id,
        conversationId: conversation.id,
        body: `msg-${i}`,
        externalMessageId: `${marker}-page-${conversation.id}-${i}`,
        // 1 min de diferença entre mensagens (i=0 mais antiga).
        createdAt: new Date(base + i * 60_000),
      });
    }
    return { tenant, conversation };
  }

  it("respeita o limit, devolve ASC e sinaliza hasMore", async () => {
    const { tenant, conversation } = await seedMessages(5);

    const page = await messageRepository.findPageByConversationId(
      tenant.id,
      conversation.id,
      { limit: 3 }
    );

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(3);
    // Últimas 3 (mais recentes), em ordem ASC.
    expect(page.items.map((m) => m.body)).toEqual(["msg-2", "msg-3", "msg-4"]);
  });

  it("before retorna a página anterior sem duplicar a mensagem do cursor", async () => {
    const { tenant, conversation } = await seedMessages(5);

    const firstPage = await messageRepository.findPageByConversationId(
      tenant.id,
      conversation.id,
      { limit: 3 }
    );
    const oldest = firstPage.items[0]!; // msg-2
    const secondPage = await messageRepository.findPageByConversationId(
      tenant.id,
      conversation.id,
      { limit: 3, before: { createdAtMs: oldest.createdAt.getTime(), id: oldest.id } }
    );

    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.items.map((m) => m.body)).toEqual(["msg-0", "msg-1"]);
    // Não inclui a mensagem do cursor (msg-2).
    expect(secondPage.items.some((m) => m.id === oldest.id)).toBe(false);
  });

  it("hasMore=false quando a conversa cabe na página", async () => {
    const { tenant, conversation } = await seedMessages(2);

    const page = await messageRepository.findPageByConversationId(
      tenant.id,
      conversation.id,
      { limit: 30 }
    );

    expect(page.hasMore).toBe(false);
    expect(page.items.map((m) => m.body)).toEqual(["msg-0", "msg-1"]);
  });

  it("é tenant+conversation-scoped (não vaza outra conversa)", async () => {
    const { tenant, conversation } = await seedMessages(2);
    // Outra conversa do MESMO tenant não deve aparecer.
    const otherContact = await contactRepository.upsertByPhone({
      tenantId: tenant.id,
      phone: "5511988887777",
      name: "Outro",
    });
    const otherConversation = await conversationRepository.upsertOpenByContact({
      tenantId: tenant.id,
      contactId: otherContact!.id,
      lastMessageAt: new Date(),
    });
    await messageRepository.createInbound({
      tenantId: tenant.id,
      conversationId: otherConversation!.id,
      body: "outra-conversa",
      externalMessageId: `${marker}-other-conv`,
      createdAt: new Date(),
    });

    const page = await messageRepository.findPageByConversationId(
      tenant.id,
      conversation.id,
      { limit: 30 }
    );

    expect(page.items.every((m) => m.conversationId === conversation.id)).toBe(true);
    expect(page.items.map((m) => m.body)).toEqual(["msg-0", "msg-1"]);
  });
});

describeDatabase("busca de mensagens (searchByConversationId)", () => {
  async function seed() {
    const { tenant, conversation } = await createConversation();
    const base = Date.UTC(2026, 5, 12, 10, 0, 0);
    const bodies = [
      "Fala Eric",        // i=0 (mais antiga)
      "Suave Eric",       // i=1
      "Plano 100% fibra", // i=2
      "Total 1000 reais", // i=3
    ];
    for (let i = 0; i < bodies.length; i += 1) {
      await messageRepository.createInbound({
        tenantId: tenant.id,
        conversationId: conversation.id,
        body: bodies[i]!,
        externalMessageId: `${marker}-search-${conversation.id}-${i}`,
        createdAt: new Date(base + i * 60_000),
      });
    }
    return { tenant, conversation };
  }

  it("ILIKE encontra mensagens da conversa (DESC, case-insensitive)", async () => {
    const { tenant, conversation } = await seed();

    const page = await messageRepository.searchByConversationId(
      tenant.id,
      conversation.id,
      { bodyIlikePattern: ilikePattern("eric"), limit: 20 }
    );

    // 2 matches; mais recente primeiro (Suave Eric antes de Fala Eric).
    expect(page.hasMore).toBe(false);
    expect(page.items.map((m) => m.body)).toEqual(["Suave Eric", "Fala Eric"]);
  });

  it("escapa %: '100%' casa literal e não vira wildcard", async () => {
    const { tenant, conversation } = await seed();

    const page = await messageRepository.searchByConversationId(
      tenant.id,
      conversation.id,
      { bodyIlikePattern: ilikePattern("100%"), limit: 20 }
    );

    // Só "Plano 100% fibra"; "Total 1000 reais" NÃO casa (% é literal).
    expect(page.items.map((m) => m.body)).toEqual(["Plano 100% fibra"]);
  });

  it("cursor pagina resultados antigos sem duplicar", async () => {
    const { tenant, conversation } = await seed();

    const p1 = await messageRepository.searchByConversationId(
      tenant.id,
      conversation.id,
      { bodyIlikePattern: ilikePattern("eric"), limit: 1 }
    );
    expect(p1.hasMore).toBe(true);
    expect(p1.items.map((m) => m.body)).toEqual(["Suave Eric"]);

    const last = p1.items[0]!;
    const p2 = await messageRepository.searchByConversationId(
      tenant.id,
      conversation.id,
      {
        bodyIlikePattern: ilikePattern("eric"),
        limit: 1,
        cursor: { createdAtMs: last.createdAt.getTime(), id: last.id },
      }
    );
    expect(p2.items.map((m) => m.body)).toEqual(["Fala Eric"]);
    expect(p2.items.some((m) => m.id === last.id)).toBe(false);
  });

  it("aplica intervalo de data junto com tenant e conversa", async () => {
    const { tenant, conversation } = await seed();

    await messageRepository.createInbound({
      tenantId: tenant.id,
      conversationId: conversation.id,
      body: "Mensagem fora da data",
      externalMessageId: `${marker}-search-outside-date`,
      createdAt: new Date("2026-06-13T10:00:00.000Z"),
    });

    const page = await messageRepository.searchByConversationId(
      tenant.id,
      conversation.id,
      {
        dateRange: {
          start: new Date("2026-06-12T00:00:00.000Z"),
          end: new Date("2026-06-13T00:00:00.000Z"),
        },
        limit: 20,
      }
    );

    expect(page.items).toHaveLength(4);
    expect(page.items.every((message) => message.createdAt.getUTCDate() === 12)).toBe(
      true
    );
  });

  it("é tenant+conversation-scoped (não vaza outra conversa)", async () => {
    const { tenant, conversation } = await seed();
    const otherContact = await contactRepository.upsertByPhone({
      tenantId: tenant.id,
      phone: "5511966665555",
      name: "Outro",
    });
    const otherConversation = await conversationRepository.upsertOpenByContact({
      tenantId: tenant.id,
      contactId: otherContact!.id,
      lastMessageAt: new Date(),
    });
    await messageRepository.createInbound({
      tenantId: tenant.id,
      conversationId: otherConversation!.id,
      body: "Eric em outra conversa",
      externalMessageId: `${marker}-search-other`,
      createdAt: new Date(),
    });

    const page = await messageRepository.searchByConversationId(
      tenant.id,
      conversation.id,
      { bodyIlikePattern: ilikePattern("eric"), limit: 20 }
    );

    expect(page.items.every((m) => m.conversationId === conversation.id)).toBe(true);
    expect(page.items.map((m) => m.body)).toEqual(["Suave Eric", "Fala Eric"]);
  });
});

describeDatabase("contexto bounded do worker (findRecentByConversationId)", () => {
  it("conversa longa (150 msgs) retorna no máximo N e as mais recentes em ASC", async () => {
    const { tenant, conversation } = await createConversation();
    const base = Date.UTC(2026, 5, 12, 8, 0, 0);
    const total = 150;

    // Insere em lote para velocidade (1 query); createdAt crescente (i=0 mais antiga).
    await db.insert(whatsappMessages).values(
      Array.from({ length: total }, (_, i) => ({
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "inbound" as const,
        body: `bulk-${i}`,
        status: "received",
        externalMessageId: `${marker}-bulk-${conversation.id}-${i}`,
        createdAt: new Date(base + i * 60_000),
      }))
    );

    const limit = 50;
    const recent = await messageRepository.findRecentByConversationId(
      tenant.id,
      conversation.id,
      limit
    );

    // A-02: NÃO carrega as 150 — no máximo N (a janela de contexto do worker).
    expect(recent).toHaveLength(limit);
    // As N MAIS recentes (bulk-100..bulk-149), em ordem ASC (cronológica p/ prompt).
    // bulk-149 é a "mensagem inbound atual" → garantidamente incluída no contexto.
    expect(recent[0]!.body).toBe("bulk-100");
    expect(recent[recent.length - 1]!.body).toBe("bulk-149");
    expect(recent.every((m) => m.conversationId === conversation.id)).toBe(true);
  });
});
