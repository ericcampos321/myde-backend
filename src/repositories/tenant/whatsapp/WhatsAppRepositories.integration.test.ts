import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../../db/client.js";
import {
  tenants,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from "../../../db/schema/index.js";
import { WhatsAppContactRepository } from "./index.js";
import { WhatsAppConversationRepository } from "./index.js";
import { WhatsAppMessageRepository } from "./index.js";
import { WhatsAppTenantRepository } from "./index.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const marker = `repository-test-${Date.now()}`;
let sequence = 0;
const createdTenantIds: string[] = [];

const tenantRepository = new WhatsAppTenantRepository();
const contactRepository = new WhatsAppContactRepository();
const conversationRepository = new WhatsAppConversationRepository();
const messageRepository = new WhatsAppMessageRepository();

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
