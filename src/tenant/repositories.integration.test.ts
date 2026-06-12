import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../db/client.js";
import {
  tenants,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from "../db/schema.js";
import { WhatsAppContactRepository } from "./whatsapp-contacts/index.js";
import { WhatsAppConversationRepository } from "./whatsapp-conversations/index.js";
import { WhatsAppMessageRepository } from "./whatsapp-messages/index.js";
import { WhatsAppTenantRepository } from "./whatsapp-tenants/index.js";

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
