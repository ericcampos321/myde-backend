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
} from "./WhatsAppOutboundService.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const describeDatabase = runDatabaseTests ? describe : describe.skip;

const marker = `outbound-test-${Date.now()}`;
const sql = postgres(env.DATABASE_URL, { max: 2 });
const database = drizzle(sql, { schema });

let tenantId = "";
let otherTenantId = "";
let conversationId = "";
let contactId = "";

const sentCalls: Array<{ phoneNumberId: string; to: string; body: string }> =
  [];

const fakeMeta: MetaOutboundClient = {
  async sendText(params) {
    sentCalls.push(params);
    return { externalMessageId: `${marker}-wamid` };
  },
};

describeDatabase("WhatsAppOutboundService (integração persistência)", () => {
  beforeAll(async () => {
    const [tenant] = await database
      .insert(tenants)
      .values({
        name: "Outbound Test Tenant",
        phoneNumberId: `${marker}-phone`,
        wabaId: `${marker}-waba`,
      })
      .returning();
    tenantId = tenant!.id;

    const [otherTenant] = await database
      .insert(tenants)
      .values({
        name: "Outbound Other Tenant",
        phoneNumberId: `${marker}-other-phone`,
      })
      .returning();
    otherTenantId = otherTenant!.id;

    const [contact] = await database
      .insert(whatsappContacts)
      .values({
        tenantId,
        phone: "5511988887777",
        name: "Cliente Outbound",
      })
      .returning();
    contactId = contact!.id;

    const [conversation] = await database
      .insert(whatsappConversations)
      .values({
        tenantId,
        contactId,
        status: "open",
      })
      .returning();
    conversationId = conversation!.id;
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
    await database.delete(tenants).where(eq(tenants.id, otherTenantId));
    await sql.end({ timeout: 5 });
  });

  it("envia pela Meta com o phoneNumberId do tenant e persiste outbound", async () => {
    const service = new WhatsAppOutboundService({ metaClient: fakeMeta });

    const result = await service.sendMessage({
      tenantId,
      conversationId,
      text: "Olá, tudo bem?",
    });

    expect(result.direction).toBe("outbound");
    expect(result.status).toBe("sent");
    expect(result.externalMessageId).toBe(`${marker}-wamid`);

    // Enviou usando o phoneNumberId do tenant, não um valor global.
    expect(sentCalls.at(-1)).toMatchObject({
      phoneNumberId: `${marker}-phone`,
      to: "5511988887777",
      body: "Olá, tudo bem?",
    });

    const [persisted] = await database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.id, result.id)
        )
      )
      .limit(1);

    expect(persisted?.direction).toBe("outbound");
    expect(persisted?.status).toBe("sent");
    expect(persisted?.externalMessageId).toBe(`${marker}-wamid`);
    expect(persisted?.body).toBe("Olá, tudo bem?");

    const [conversation] = await database
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, conversationId))
      .limit(1);
    expect(conversation?.lastMessageAt).not.toBeNull();
  });

  it("rejeita conversa de outro tenant (isolamento)", async () => {
    const service = new WhatsAppOutboundService({ metaClient: fakeMeta });

    // Tenta enviar usando o tenant errado para uma conversa que existe sob outro tenant.
    await expect(
      service.sendMessage({
        tenantId: otherTenantId,
        conversationId,
        text: "mensagem indevida",
      })
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });

  it("rejeita tenant inexistente", async () => {
    const service = new WhatsAppOutboundService({ metaClient: fakeMeta });

    await expect(
      service.sendMessage({
        tenantId: "00000000-0000-0000-0000-0000000000ff",
        conversationId,
        text: "teste",
      })
    ).rejects.toMatchObject({ code: "TENANT_NOT_FOUND" });
  });
});