import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../../db/client.js";
import {
  aiInteractionLogs,
  tenants,
  whatsappContacts,
  whatsappConversations,
} from "../../../db/schema/index.js";
import {
  WhatsAppContactRepository,
  WhatsAppConversationRepository,
  WhatsAppTenantRepository,
} from "../whatsapp/index.js";
import { AiInteractionLogRepository } from "./index.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const marker = `ai-log-repository-test-${Date.now()}`;
let sequence = 0;
const createdTenantIds: string[] = [];

const tenantRepository = new WhatsAppTenantRepository();
const contactRepository = new WhatsAppContactRepository();
const conversationRepository = new WhatsAppConversationRepository();
const interactionLogRepository = new AiInteractionLogRepository();

async function createConversation() {
  const tenant = await tenantRepository.create({
    name: "AI Log Repository Test",
    phoneNumberId: `${marker}-${sequence++}`,
    wabaId: "WABA_AI_LOG_TEST",
  });
  expect(tenant).toBeDefined();
  createdTenantIds.push(tenant!.id);

  const contact = await contactRepository.upsertByPhone({
    tenantId: tenant!.id,
    phone: `55119999${String(sequence).padStart(4, "0")}`,
    name: "Contato Log",
  });
  const conversation = await conversationRepository.upsertOpenByContact({
    tenantId: tenant!.id,
    contactId: contact!.id,
    lastMessageAt: new Date(),
  });

  return { tenant: tenant!, contact: contact!, conversation: conversation! };
}

afterAll(async () => {
  if (!runDatabaseTests) return;

  for (const tenantId of createdTenantIds) {
    await db.delete(aiInteractionLogs).where(eq(aiInteractionLogs.tenantId, tenantId));
    await db
      .delete(whatsappConversations)
      .where(eq(whatsappConversations.tenantId, tenantId));
    await db.delete(whatsappContacts).where(eq(whatsappContacts.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }

  await closeDb();
});

describeDatabase("AiInteractionLogRepository com PostgreSQL", () => {
  it("cria log tenant-scoped", async () => {
    const { tenant, contact, conversation } = await createConversation();

    const created = await interactionLogRepository.create({
      tenantId: tenant.id,
      conversationId: conversation.id,
      contactId: contact.id,
      operatorId: "operator-1",
      stage: "input",
      action: "block",
      riskLevel: "high",
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
      blocked: true,
      source: "openai",
      promptVersion: "v1",
      inputCharCount: 42,
      outputCharCount: null,
      model: "gpt-test",
    });

    expect(created?.id).toBeDefined();
    expect(created?.tenantId).toBe(tenant.id);
    expect(created?.conversationId).toBe(conversation.id);
  });

  it("countRecentHighRisk conta apenas high blocked no tenant e conversa", async () => {
    const a = await createConversation();
    const b = await createConversation();
    const now = new Date();
    const since = new Date(now.getTime() - 60_000);

    await interactionLogRepository.create({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      contactId: a.contact.id,
      operatorId: "operator-1",
      stage: "input",
      action: "block",
      riskLevel: "high",
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
      blocked: true,
      source: "openai",
      promptVersion: "v1",
      inputCharCount: 42,
      outputCharCount: null,
      model: "gpt-test",
    });
    await interactionLogRepository.create({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      contactId: a.contact.id,
      operatorId: "operator-1",
      stage: "output",
      action: "flag",
      riskLevel: "high",
      riskReasons: ["output_leak"],
      matchedRules: ["output.leak"],
      blocked: false,
      source: "openai",
      promptVersion: "v1",
      inputCharCount: 42,
      outputCharCount: 80,
      model: "gpt-test",
    });
    await interactionLogRepository.create({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      contactId: a.contact.id,
      operatorId: "operator-1",
      stage: "input",
      action: "block",
      riskLevel: "medium",
      riskReasons: ["recurring_abuse"],
      matchedRules: ["recurring.abuse"],
      blocked: true,
      source: "openai",
      promptVersion: "v1",
      inputCharCount: 10,
      outputCharCount: null,
      model: "gpt-test",
    });
    await interactionLogRepository.create({
      tenantId: b.tenant.id,
      conversationId: b.conversation.id,
      contactId: b.contact.id,
      operatorId: "operator-2",
      stage: "input",
      action: "block",
      riskLevel: "high",
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
      blocked: true,
      source: "openai",
      promptVersion: "v1",
      inputCharCount: 42,
      outputCharCount: null,
      model: "gpt-test",
    });

    await expect(
      interactionLogRepository.countRecentHighRisk({
        tenantId: a.tenant.id,
        conversationId: a.conversation.id,
        since,
      })
    ).resolves.toBe(1);
  });
});
