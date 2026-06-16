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

  it("agrega uso (summary/byModel) tenant-scoped, somando tokens com null=0", async () => {
    const a = await createConversation();
    const other = await createConversation();
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);

    // 2 logs completed (com tokens) + 1 blocked (sem tokens) no tenant A.
    await interactionLogRepository.create({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      contactId: a.contact.id,
      stage: "input",
      action: "allow",
      riskLevel: "low",
      riskReasons: [],
      matchedRules: [],
      blocked: false,
      source: "openai",
      provider: "openai",
      promptVersion: "v1",
      inputCharCount: 10,
      outputCharCount: 20,
      model: "gpt-4o-mini",
      promptTokens: 100,
      cachedPromptTokens: 10,
      completionTokens: 50,
      totalTokens: 150,
      durationMs: 800,
      contextItemsCount: 3,
      contextChars: 1200,
    });
    await interactionLogRepository.create({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      contactId: a.contact.id,
      stage: "input",
      action: "allow",
      riskLevel: "low",
      riskReasons: [],
      matchedRules: [],
      blocked: false,
      source: "openai",
      provider: "openai",
      promptVersion: "v1",
      inputCharCount: 10,
      outputCharCount: 20,
      model: "gpt-4o-mini",
      promptTokens: 200,
      cachedPromptTokens: 20,
      completionTokens: 100,
      totalTokens: 300,
      durationMs: 1200,
    });
    await interactionLogRepository.create({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      contactId: a.contact.id,
      stage: "input",
      action: "block",
      riskLevel: "high",
      riskReasons: ["policy_bypass"],
      matchedRules: ["policy.bypass"],
      blocked: true,
      source: null,
      inputCharCount: 5,
      outputCharCount: null,
      model: null,
    });
    // Log de OUTRO tenant — não deve entrar.
    await interactionLogRepository.create({
      tenantId: other.tenant.id,
      conversationId: other.conversation.id,
      contactId: other.contact.id,
      stage: "input",
      action: "allow",
      riskLevel: "low",
      riskReasons: [],
      matchedRules: [],
      blocked: false,
      source: "openai",
      model: "gpt-4o-mini",
      inputCharCount: 1,
      outputCharCount: 1,
      promptTokens: 9999,
      cachedPromptTokens: 9999,
      completionTokens: 9999,
      totalTokens: 9999,
    });

    const filter = { tenantId: a.tenant.id, from, to };

    const summary = await interactionLogRepository.getUsageSummary(filter);
    expect(summary.totalInteractions).toBe(3);
    expect(summary.blockedInteractions).toBe(1);
    expect(summary.promptTokens).toBe(300);
    expect(summary.cachedPromptTokens).toBe(30);
    expect(summary.completionTokens).toBe(150);
    expect(summary.totalTokens).toBe(450);
    expect(summary.avgDurationMs).toBe(1000); // (800+1200)/2

    const byModel = await interactionLogRepository.getUsageByModel(filter);
    const mini = byModel.find((m) => m.model === "gpt-4o-mini");
    expect(mini?.interactions).toBe(2);
    expect(mini?.cachedPromptTokens).toBe(30);
    expect(mini?.totalTokens).toBe(450);

    const recent = await interactionLogRepository.listRecentUsage(filter, 10);
    expect(recent.items.length).toBe(3);
    // não vaza outro tenant
    expect(recent.items.every((r) => r.conversationId === a.conversation.id)).toBe(
      true
    );
    // campos seguros apenas
    expect(Object.keys(recent.items[0]!).sort()).toEqual(
      [
        "blocked",
        "cachedPromptTokens",
        "completionTokens",
        "conversationId",
        "createdAt",
        "durationMs",
        "id",
        "model",
        "promptTokens",
        "provider",
        "riskLevel",
        "source",
        "stage",
        "totalTokens",
      ].sort()
    );
    expect(recent.hasNextPage).toBe(false);
  });

  it("conta logs de auto-reply do worker (stage auto_reply) nos agregados", async () => {
    const a = await createConversation();
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);

    await interactionLogRepository.create({
      tenantId: a.tenant.id,
      conversationId: a.conversation.id,
      contactId: a.contact.id,
      stage: "auto_reply",
      action: "allow",
      riskLevel: "low",
      riskReasons: [],
      matchedRules: [],
      blocked: false,
      source: "openai",
      provider: "openai",
      promptVersion: null,
      inputCharCount: 12,
      outputCharCount: 40,
      model: "gpt-4o-mini",
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      durationMs: 950,
      contextItemsCount: 3,
      contextChars: 2048,
    });

    const filter = { tenantId: a.tenant.id, from, to };

    const summary = await interactionLogRepository.getUsageSummary(filter);
    expect(summary.totalInteractions).toBe(1);
    expect(summary.blockedInteractions).toBe(0);
    expect(summary.totalTokens).toBe(150);
    expect(summary.avgDurationMs).toBe(950);

    const recent = await interactionLogRepository.listRecentUsage(filter, 10);
    expect(recent.items.length).toBe(1);
    expect(recent.items[0]!.stage).toBe("auto_reply");
    // O contrato seguro NÃO expõe action/reasons — só metadados seguros.
    expect(Object.keys(recent.items[0]!)).not.toContain("action");
    expect(Object.keys(recent.items[0]!)).not.toContain("riskReasons");
  });
});
