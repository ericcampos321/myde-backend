import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildApp } from "../../bootstrap/app.js";
import { env } from "../../config/env.js";
import * as schema from "../../db/schema.js";
import {
  tenants,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from "../../db/schema.js";
import { hmacSha256Hex } from "../../shared/utils/crypto.js";
import { WhatsAppContactRepository } from "../whatsapp-contacts/index.js";
import { WhatsAppConversationRepository } from "../whatsapp-conversations/index.js";
import { WhatsAppMessageRepository } from "../whatsapp-messages/index.js";
import { WhatsAppTenantRepository } from "../whatsapp-tenants/index.js";
import { WhatsAppWebhookService } from "./WhatsAppWebhookService.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "true";
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const marker = `webhook-test-${Date.now()}`;
const phoneNumberId = `${marker}-phone-number`;
const unknownPhoneNumberId = `${marker}-unknown-phone-number`;
const contactPhone = "5511977770000";
const appSecret =
  process.env.META_APP_SECRET ?? "super-secret-app-secret-trocar";

const sql = postgres(env.DATABASE_URL, { max: 2 });
const database = drizzle(sql, { schema });
const tenantRepository = new WhatsAppTenantRepository(database);
const contactRepository = new WhatsAppContactRepository(database);
const conversationRepository = new WhatsAppConversationRepository(database);
const messageRepository = new WhatsAppMessageRepository(database);
let tenantId = "";
let app: FastifyInstance;

function payload(options: {
  messageId?: string;
  targetPhoneNumberId?: string;
  includeText?: boolean;
} = {}) {
  const includeText = options.includeText ?? true;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_WEBHOOK_TEST",
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                phone_number_id: options.targetPhoneNumberId ?? phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: "Cliente Webhook" },
                  wa_id: contactPhone,
                },
              ],
              messages: [
                {
                  from: contactPhone,
                  id: options.messageId ?? `${marker}-wamid-default`,
                  timestamp: "1760000000",
                  type: includeText ? "text" : "image",
                  ...(includeText
                    ? { text: { body: "Quais sao os planos?" } }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function injectSigned(body: unknown, signatureBody: unknown = body) {
  const rawBody = JSON.stringify(body);
  return app.inject({
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": hmacSha256Hex(
        Buffer.from(JSON.stringify(signatureBody)),
        appSecret
      ),
    },
    payload: rawBody,
  });
}

beforeAll(async () => {
  if (!runDatabaseTests) return;

  const tenant = await tenantRepository.create({
    name: "Webhook Test",
    phoneNumberId,
    wabaId: "WABA_WEBHOOK_TEST",
  });
  tenantId = tenant!.id;

  const webhookService = new WhatsAppWebhookService({
    tenantRepository,
    contactRepository,
    conversationRepository,
    messageRepository,
  });
  app = await buildApp({ webhookService });
  await app.ready();
});

afterAll(async () => {
  if (!runDatabaseTests) return;

  await app.close();
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

describeDatabase("POST /webhook com persistencia", () => {
  it("persiste contato, conversa e mensagem inbound", async () => {
    const messageId = `${marker}-wamid-persist`;
    const response = await injectSigned(payload({ messageId }));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      received: true,
      persisted: true,
      duplicated: false,
    });

    const contact = await contactRepository.findByPhone(tenantId, contactPhone);
    const conversation = await conversationRepository.findById(
      tenantId,
      (
        await database
          .select()
          .from(whatsappConversations)
          .where(eq(whatsappConversations.tenantId, tenantId))
          .limit(1)
      )[0]!.id
    );
    const message = await messageRepository.findByExternalMessageId(
      tenantId,
      messageId
    );

    expect(contact?.name).toBe("Cliente Webhook");
    expect(conversation?.contactId).toBe(contact?.id);
    expect(message).toMatchObject({
      tenantId,
      conversationId: conversation?.id,
      direction: "inbound",
      body: "Quais sao os planos?",
      status: "received",
    });
    expect(message?.createdAt).toEqual(new Date(1760000000 * 1000));
  });

  it("nao duplica mensagem e retorna duplicated true", async () => {
    const messageId = `${marker}-wamid-duplicate`;
    const body = payload({ messageId });

    expect((await injectSigned(body)).json()).toMatchObject({
      persisted: true,
      duplicated: false,
    });
    expect((await injectSigned(body)).json()).toEqual({
      received: true,
      persisted: false,
      duplicated: true,
    });

    const rows = await database
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.externalMessageId, messageId)
        )
      );
    expect(rows).toHaveLength(1);
  });

  it("ignora tenant desconhecido sem persistir", async () => {
    const messageId = `${marker}-wamid-unknown`;
    const response = await injectSigned(
      payload({ messageId, targetPhoneNumberId: unknownPhoneNumberId })
    );

    expect(response.json()).toEqual({
      received: true,
      ignored: true,
      reason: "unknown_tenant",
    });
    expect(
      await messageRepository.findByExternalMessageId(tenantId, messageId)
    ).toBeNull();
  });

  it("ignora evento sem text", async () => {
    const response = await injectSigned(payload({ includeText: false }));

    expect(response.json()).toEqual({
      received: true,
      ignored: true,
      reason: "unsupported_event",
    });
  });

  it("rejeita assinatura invalida antes de persistir", async () => {
    const messageId = `${marker}-wamid-invalid-signature`;
    const response = await injectSigned(
      payload({ messageId }),
      payload({ messageId: "outro-id" })
    );

    expect(response.statusCode).toBe(403);
    expect(
      await messageRepository.findByExternalMessageId(tenantId, messageId)
    ).toBeNull();
  });
});
