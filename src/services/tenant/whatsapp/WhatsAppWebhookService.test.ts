import { describe, expect, it, vi } from "vitest";
import { WhatsAppWebhookService } from "./WhatsAppWebhookService.js";
import type { NormalizedInboundMessage } from "../../../types/tenant/whatsapp/WhatsAppWebhookTypes.js";

/**
 * Cobre o achado A-03: webhook inbound duplicado deve REPARAR o job de
 * processamento de forma idempotente (jobId = externalMessageId), sem recriar a
 * mensagem, sem chamar OpenAI/Meta e sem derrubar o ACK 200. Todas as dependências
 * são mockadas (sem banco/Redis).
 */

const tenant = {
  id: "tenant-1",
  name: "NeoFibra",
  phoneNumberId: "123456789012345",
  wabaId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildInbound(
  overrides: Partial<NormalizedInboundMessage> = {}
): NormalizedInboundMessage {
  return {
    phoneNumberId: "123456789012345",
    displayPhoneNumber: "5515991270311",
    wabaId: "WABA_TEST",
    externalMessageId: "wamid.test-1",
    contactPhone: "5511999990000",
    contactName: "Cliente Teste",
    text: "Quais sao os planos?",
    timestamp: new Date("2026-06-16T10:00:00.000Z"),
    ...overrides,
  };
}

function makeLog() {
  const log: Record<string, ReturnType<typeof vi.fn>> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  // child() retorna o próprio fake (correlação por requestId não importa aqui).
  log.child = vi.fn(() => log);
  return log;
}

function buildService(options: {
  mapping?: unknown;
  existingMessage?: unknown;
  enqueue?: ReturnType<typeof vi.fn>;
  createInbound?: ReturnType<typeof vi.fn>;
  upsertByPhone?: ReturnType<typeof vi.fn>;
  upsertOpenByContact?: ReturnType<typeof vi.fn>;
}) {
  const enqueueInboundMessage =
    options.enqueue ??
    vi.fn().mockResolvedValue({
      jobId: "wamid.test-1",
      jobName: "process-inbound-message",
    });
  const createInbound =
    options.createInbound ??
    vi.fn().mockResolvedValue({
      id: "msg-new",
      tenantId: tenant.id,
      conversationId: "conv-1",
      direction: "inbound",
      externalMessageId: "wamid.test-1",
    });
  const upsertByPhone =
    options.upsertByPhone ??
    vi.fn().mockResolvedValue({ id: "contact-1", tenantId: tenant.id });
  const upsertOpenByContact =
    options.upsertOpenByContact ??
    vi.fn().mockResolvedValue({ id: "conv-1", tenantId: tenant.id });

  const findByExternalMessageId = vi
    .fn()
    .mockResolvedValue(options.existingMessage ?? null);

  const log = makeLog();

  const deps = {
    signatureService: { validateSignature: vi.fn() },
    payloadMapper: {
      map:
        options.mapping !== undefined
          ? vi.fn().mockReturnValue(options.mapping)
          : vi.fn().mockReturnValue({ kind: "message", message: buildInbound() }),
    },
    tenantResolutionPolicy: {
      resolveByPhoneNumberId: vi
        .fn()
        .mockResolvedValue({ status: "found", tenant }),
    },
    contactService: { upsertByPhone },
    messageService: { findByExternalMessageId, createInbound },
    conversationRepository: { upsertOpenByContact },
    messageProcessingQueue: { enqueueInboundMessage },
    log,
  };

  // Os tipos de dependência são classes concretas; em teste injetamos mocks
  // estruturais (o arquivo de teste não é typechecked pelo tsc).
  const service = new WhatsAppWebhookService(
    deps as unknown as ConstructorParameters<typeof WhatsAppWebhookService>[0]
  );

  return {
    service,
    enqueueInboundMessage,
    createInbound,
    upsertByPhone,
    upsertOpenByContact,
    findByExternalMessageId,
    log,
  };
}

const webhookParams = {
  rawBody: Buffer.from("{}"),
  headers: { "x-hub-signature-256": "sig" },
  payload: {},
};

describe("WhatsAppWebhookService — inbound novo", () => {
  it("persiste e enfileira o job com o payload correto", async () => {
    const ctx = buildService({});

    const result = await ctx.service.receiveWebhook(webhookParams);

    expect(result).toEqual({
      received: true,
      persisted: true,
      duplicated: false,
    });
    expect(ctx.createInbound).toHaveBeenCalledTimes(1);
    expect(ctx.enqueueInboundMessage).toHaveBeenCalledTimes(1);
    expect(ctx.enqueueInboundMessage).toHaveBeenCalledWith({
      tenantId: tenant.id,
      conversationId: "conv-1",
      messageId: "msg-new",
      externalMessageId: "wamid.test-1",
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
      displayPhoneNumber: "5515991270311",
    });
  });
});

describe("WhatsAppWebhookService — inbound duplicado (A-03)", () => {
  const existingInbound = {
    id: "msg-existing",
    tenantId: tenant.id,
    conversationId: "conv-9",
    direction: "inbound" as const,
    externalMessageId: "wamid.test-1",
  };

  it("não cria segunda mensagem nem reprocessa contato/conversa", async () => {
    const ctx = buildService({ existingMessage: existingInbound });

    const result = await ctx.service.receiveWebhook(webhookParams);

    expect(result).toEqual({
      received: true,
      persisted: false,
      duplicated: true,
    });
    expect(ctx.createInbound).not.toHaveBeenCalled();
    expect(ctx.upsertByPhone).not.toHaveBeenCalled();
    expect(ctx.upsertOpenByContact).not.toHaveBeenCalled();
  });

  it("repara o job com re-enqueue idempotente (jobId = externalMessageId)", async () => {
    const ctx = buildService({ existingMessage: existingInbound });

    await ctx.service.receiveWebhook(webhookParams);

    expect(ctx.enqueueInboundMessage).toHaveBeenCalledTimes(1);
    expect(ctx.enqueueInboundMessage).toHaveBeenCalledWith({
      tenantId: tenant.id,
      conversationId: "conv-9",
      messageId: "msg-existing",
      // chave idempotente: o jobId no BullMQ é o externalMessageId.
      externalMessageId: "wamid.test-1",
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
      displayPhoneNumber: "5515991270311",
    });
  });

  it("entregas duplicadas repetidas usam sempre o mesmo jobId (BullMQ não duplica)", async () => {
    const ctx = buildService({ existingMessage: existingInbound });

    await ctx.service.receiveWebhook(webhookParams);
    await ctx.service.receiveWebhook(webhookParams);

    expect(ctx.enqueueInboundMessage).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = ctx.enqueueInboundMessage.mock.calls;
    expect(secondCall[0]).toEqual(firstCall[0]);
    expect(secondCall[0].externalMessageId).toBe("wamid.test-1");
  });

  it("preserva tenant isolation: o job usa o tenantId da mensagem existente", async () => {
    const ctx = buildService({ existingMessage: existingInbound });

    await ctx.service.receiveWebhook(webhookParams);

    expect(ctx.enqueueInboundMessage.mock.calls[0][0].tenantId).toBe(tenant.id);
  });

  it("não re-enfileira quando a mensagem existente é outbound", async () => {
    const ctx = buildService({
      existingMessage: { ...existingInbound, direction: "outbound" },
    });

    const result = await ctx.service.receiveWebhook(webhookParams);

    expect(result.duplicated).toBe(true);
    expect(ctx.enqueueInboundMessage).not.toHaveBeenCalled();
    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "webhook.inbound.reenqueue_skipped" }),
      expect.any(String)
    );
  });

  it("não re-enfileira quando a mensagem existente não tem externalMessageId", async () => {
    const ctx = buildService({
      existingMessage: { ...existingInbound, externalMessageId: null },
    });

    await ctx.service.receiveWebhook(webhookParams);

    expect(ctx.enqueueInboundMessage).not.toHaveBeenCalled();
  });

  it("falha no re-enqueue é logada de forma segura e mantém ACK 200", async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error("redis indisponível"));
    const ctx = buildService({
      existingMessage: existingInbound,
      enqueue,
    });

    const result = await ctx.service.receiveWebhook(webhookParams);

    // Best-effort: não relança; o duplicado continua 200.
    expect(result).toEqual({
      received: true,
      persisted: false,
      duplicated: true,
    });
    expect(ctx.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "webhook.inbound.reenqueue_failed" }),
      expect.any(String)
    );
    // Log seguro: o payload do log não carrega prompt/token/segredo.
    const loggedFields = Object.keys(ctx.log.error.mock.calls[0][0]);
    expect(loggedFields).not.toContain("body");
    expect(loggedFields).not.toContain("text");
    expect(loggedFields).not.toContain("token");
  });
});
