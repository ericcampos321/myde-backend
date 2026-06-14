import { describe, it, expect, vi } from "vitest";
import { InboxService } from "./InboxService.js";
import { AppError } from "../../../errors/AppError.js";

/**
 * Garante o contrato consumido pelo frontend: sem conversas, o endpoint retorna
 * uma lista vazia (200 []) — nunca um erro. Isso evita que a inbox renderize
 * estado de erro quando o banco ainda não tem dados (antes do primeiro webhook).
 */
describe("InboxService.listConversations (banco vazio)", () => {
  const tenant = {
    id: "tenant-1",
    name: "NeoFibra",
    phoneNumberId: "123456789012345",
    wabaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("retorna [] quando não há conversas, sem tocar contatos/mensagens", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const listByTenant = vi.fn().mockResolvedValue([]);
    const findByIds = vi.fn();
    const findByConversationIds = vi.fn();

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant, findById: vi.fn() },
      contactRepository: { findByIds },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds,
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId: vi.fn(),
      },
      readStateRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        upsert: vi.fn(),
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    const result = await service.listConversations();

    expect(result).toEqual([]);
    expect(listByTenant).toHaveBeenCalledWith(tenant.id);
    // Sem conversas: não consulta contatos nem mensagens (early return).
    expect(findByIds).not.toHaveBeenCalled();
    expect(findByConversationIds).not.toHaveBeenCalled();
  });
});

describe("InboxService.listContacts", () => {
  const tenant = {
    id: "tenant-1",
    name: "NeoFibra",
    phoneNumberId: "123456789012345",
    wabaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("retorna contatos do tenant atual com busca opcional", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const listByTenant = vi.fn().mockResolvedValue([
      {
        id: "contact-1",
        tenantId: tenant.id,
        phone: "5511999999999",
        name: "Maria",
        createdAt: new Date("2026-06-12T10:00:00.000Z"),
        updatedAt: new Date("2026-06-12T12:00:00.000Z"),
      },
    ]);

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant: vi.fn(), findById: vi.fn() },
      contactRepository: { findByIds: vi.fn(), listByTenant },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId: vi.fn(),
      },
      readStateRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        upsert: vi.fn(),
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    const result = await service.listContacts("maria");

    expect(listByTenant).toHaveBeenCalledWith(tenant.id, "maria");
    expect(result).toEqual([
      {
        id: "contact-1",
        name: "Maria",
        phone: "5511999999999",
        profileName: "Maria",
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T12:00:00.000Z",
      },
    ]);
  });

  it("retorna [] quando não há contatos", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const listByTenant = vi.fn().mockResolvedValue([]);

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant: vi.fn(), findById: vi.fn() },
      contactRepository: { findByIds: vi.fn(), listByTenant },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId: vi.fn(),
      },
      readStateRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        upsert: vi.fn(),
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    await expect(service.listContacts()).resolves.toEqual([]);
    expect(listByTenant).toHaveBeenCalledWith(tenant.id, undefined);
  });
});

describe("InboxService unread state", () => {
  const tenant = {
    id: "tenant-1",
    name: "NeoFibra",
    phoneNumberId: "123456789012345",
    wabaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("conta apenas inbound apos o lastReadAt do operador", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const listByTenant = vi.fn().mockResolvedValue([
      {
        id: "conv-1",
        tenantId: tenant.id,
        contactId: "contact-1",
        status: "open",
        lastMessageAt: new Date("2026-06-12T12:05:00.000Z"),
        createdAt: new Date("2026-06-12T10:00:00.000Z"),
        updatedAt: new Date("2026-06-12T12:05:00.000Z"),
      },
    ]);
    const findByIds = vi.fn().mockResolvedValue([
      {
        id: "contact-1",
        tenantId: tenant.id,
        phone: "5511999999999",
        name: "Maria",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const findByConversationIds = vi.fn().mockResolvedValue([
      {
        id: "msg-1",
        tenantId: tenant.id,
        conversationId: "conv-1",
        direction: "inbound",
        body: "Primeira inbound",
        status: "received",
        externalMessageId: null,
        failureCode: null,
        failureReason: null,
        failedAt: null,
        replyToMessageId: null,
        createdAt: new Date("2026-06-12T10:10:00.000Z"),
        updatedAt: new Date("2026-06-12T10:10:00.000Z"),
      },
      {
        id: "msg-2",
        tenantId: tenant.id,
        conversationId: "conv-1",
        direction: "outbound",
        body: "Resposta",
        status: "sent",
        externalMessageId: null,
        failureCode: null,
        failureReason: null,
        failedAt: null,
        replyToMessageId: null,
        createdAt: new Date("2026-06-12T11:00:00.000Z"),
        updatedAt: new Date("2026-06-12T11:00:00.000Z"),
      },
      {
        id: "msg-3",
        tenantId: tenant.id,
        conversationId: "conv-1",
        direction: "inbound",
        body: "Nova inbound",
        status: "received",
        externalMessageId: null,
        failureCode: null,
        failureReason: null,
        failedAt: null,
        replyToMessageId: null,
        createdAt: new Date("2026-06-12T12:00:00.000Z"),
        updatedAt: new Date("2026-06-12T12:00:00.000Z"),
      },
    ]);
    const findByConversationIdsReadState = vi.fn().mockResolvedValue([
      {
        id: "state-1",
        tenantId: tenant.id,
        conversationId: "conv-1",
        operatorId: "operator-1",
        lastReadAt: new Date("2026-06-12T11:30:00.000Z"),
        lastReadMessageId: "msg-2",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant, findById: vi.fn() },
      contactRepository: { findByIds, listByTenant: vi.fn() },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds,
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId: vi.fn(),
      },
      readStateRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: findByConversationIdsReadState,
        upsert: vi.fn(),
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    const result = await service.listConversations();

    expect(findByConversationIdsReadState).toHaveBeenCalledWith(
      tenant.id,
      "operator-1",
      ["conv-1"]
    );
    expect(result[0]?.unread).toBe(1);
    expect(result[0]?.lastMessage).toBe("Nova inbound");
  });

  it("sem read state conta todas as inbound como nao lidas", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const listByTenant = vi.fn().mockResolvedValue([
      {
        id: "conv-1",
        tenantId: tenant.id,
        contactId: "contact-1",
        status: "open",
        lastMessageAt: new Date("2026-06-12T12:05:00.000Z"),
        createdAt: new Date("2026-06-12T10:00:00.000Z"),
        updatedAt: new Date("2026-06-12T12:05:00.000Z"),
      },
    ]);

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant, findById: vi.fn() },
      contactRepository: {
        findByIds: vi.fn().mockResolvedValue([
          {
            id: "contact-1",
            tenantId: tenant.id,
            phone: "5511999999999",
            name: "Maria",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        listByTenant: vi.fn(),
      },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn().mockResolvedValue([
          {
            id: "msg-1",
            tenantId: tenant.id,
            conversationId: "conv-1",
            direction: "inbound",
            body: "Oi",
            status: "received",
            externalMessageId: null,
            failureCode: null,
            failureReason: null,
            failedAt: null,
            replyToMessageId: null,
            createdAt: new Date("2026-06-12T10:10:00.000Z"),
            updatedAt: new Date("2026-06-12T10:10:00.000Z"),
          },
          {
            id: "msg-2",
            tenantId: tenant.id,
            conversationId: "conv-1",
            direction: "outbound",
            body: "Resposta",
            status: "sent",
            externalMessageId: null,
            failureCode: null,
            failureReason: null,
            failedAt: null,
            replyToMessageId: null,
            createdAt: new Date("2026-06-12T10:15:00.000Z"),
            updatedAt: new Date("2026-06-12T10:15:00.000Z"),
          },
          {
            id: "msg-3",
            tenantId: tenant.id,
            conversationId: "conv-1",
            direction: "inbound",
            body: "Tudo bem?",
            status: "received",
            externalMessageId: null,
            failureCode: null,
            failureReason: null,
            failedAt: null,
            replyToMessageId: null,
            createdAt: new Date("2026-06-12T10:20:00.000Z"),
            updatedAt: new Date("2026-06-12T10:20:00.000Z"),
          },
        ]),
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId: vi.fn(),
      },
      readStateRepository: {
        findByConversationId: vi.fn().mockResolvedValue(null),
        findByConversationIds: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    const [conversation] = await service.listConversations();
    expect(conversation?.unread).toBe(2);
  });

  it("markConversationAsRead grava estado e depois a conversa pode zerar para esse operador", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const findById = vi.fn().mockResolvedValue({
      id: "conv-1",
      tenantId: tenant.id,
      contactId: "contact-1",
      status: "open",
      lastMessageAt: new Date("2026-06-12T12:05:00.000Z"),
      createdAt: new Date("2026-06-12T10:00:00.000Z"),
      updatedAt: new Date("2026-06-12T12:05:00.000Z"),
    });
    const findLatestByConversationId = vi.fn().mockResolvedValue({
      id: "msg-3",
      tenantId: tenant.id,
      conversationId: "conv-1",
      direction: "inbound",
      body: "Nova inbound",
      status: "received",
      externalMessageId: null,
      failureCode: null,
      failureReason: null,
      failedAt: null,
      replyToMessageId: null,
      createdAt: new Date("2026-06-12T12:00:00.000Z"),
      updatedAt: new Date("2026-06-12T12:00:00.000Z"),
    });
    const findLatestInboundByConversationId = vi.fn().mockResolvedValue({
      id: "msg-3",
      tenantId: tenant.id,
      conversationId: "conv-1",
      direction: "inbound",
      body: "Nova inbound",
      status: "received",
      externalMessageId: null,
      failureCode: null,
      failureReason: null,
      failedAt: null,
      replyToMessageId: null,
      createdAt: new Date("2026-06-12T12:00:00.000Z"),
      updatedAt: new Date("2026-06-12T12:00:00.000Z"),
    });
    const upsert = vi.fn().mockResolvedValue(undefined);

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant: vi.fn(), findById },
      contactRepository: { findByIds: vi.fn(), listByTenant: vi.fn() },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        findLatestByConversationId,
        findLatestInboundByConversationId,
      },
      readStateRepository: {
        findByConversationId: vi.fn().mockResolvedValue(null),
        findByConversationIds: vi.fn(),
        upsert,
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    await service.markConversationAsRead("conv-1");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant.id,
        conversationId: "conv-1",
        operatorId: "operator-1",
        lastReadMessageId: "msg-3",
      })
    );
  });

  it("markConversationAsRead repetido sem nova inbound nao faz update", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const findById = vi.fn().mockResolvedValue({
      id: "conv-1",
      tenantId: tenant.id,
      contactId: "contact-1",
      status: "open",
      lastMessageAt: new Date("2026-06-12T12:05:00.000Z"),
      createdAt: new Date("2026-06-12T10:00:00.000Z"),
      updatedAt: new Date("2026-06-12T12:05:00.000Z"),
    });
    const findByConversationId = vi.fn().mockResolvedValue({
      id: "state-1",
      tenantId: tenant.id,
      conversationId: "conv-1",
      operatorId: "operator-1",
      lastReadAt: new Date("2026-06-12T12:10:00.000Z"),
      lastReadMessageId: "msg-3",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const findLatestInboundByConversationId = vi.fn().mockResolvedValue({
      id: "msg-3",
      tenantId: tenant.id,
      conversationId: "conv-1",
      direction: "inbound",
      body: "Nova inbound",
      status: "received",
      externalMessageId: null,
      failureCode: null,
      failureReason: null,
      failedAt: null,
      replyToMessageId: null,
      createdAt: new Date("2026-06-12T12:00:00.000Z"),
      updatedAt: new Date("2026-06-12T12:00:00.000Z"),
    });
    const upsert = vi.fn();

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant: vi.fn(), findById },
      contactRepository: { findByIds: vi.fn(), listByTenant: vi.fn() },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId,
      },
      readStateRepository: {
        findByConversationId,
        findByConversationIds: vi.fn(),
        upsert,
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    await service.markConversationAsRead("conv-1");

    expect(findByConversationId).toHaveBeenCalledWith(
      tenant.id,
      "operator-1",
      "conv-1"
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("nova inbound posterior permite novo update", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const findById = vi.fn().mockResolvedValue({
      id: "conv-1",
      tenantId: tenant.id,
      contactId: "contact-1",
      status: "open",
      lastMessageAt: new Date("2026-06-12T12:30:00.000Z"),
      createdAt: new Date("2026-06-12T10:00:00.000Z"),
      updatedAt: new Date("2026-06-12T12:30:00.000Z"),
    });
    const findByConversationId = vi.fn().mockResolvedValue({
      id: "state-1",
      tenantId: tenant.id,
      conversationId: "conv-1",
      operatorId: "operator-1",
      lastReadAt: new Date("2026-06-12T12:10:00.000Z"),
      lastReadMessageId: "msg-3",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const findLatestInboundByConversationId = vi.fn().mockResolvedValue({
      id: "msg-4",
      tenantId: tenant.id,
      conversationId: "conv-1",
      direction: "inbound",
      body: "Inbound mais nova",
      status: "received",
      externalMessageId: null,
      failureCode: null,
      failureReason: null,
      failedAt: null,
      replyToMessageId: null,
      createdAt: new Date("2026-06-12T12:20:00.000Z"),
      updatedAt: new Date("2026-06-12T12:20:00.000Z"),
    });
    const findLatestByConversationId = vi.fn().mockResolvedValue({
      id: "msg-5",
      tenantId: tenant.id,
      conversationId: "conv-1",
      direction: "outbound",
      body: "Resposta mais nova",
      status: "sent",
      externalMessageId: null,
      failureCode: null,
      failureReason: null,
      failedAt: null,
      replyToMessageId: null,
      createdAt: new Date("2026-06-12T12:30:00.000Z"),
      updatedAt: new Date("2026-06-12T12:30:00.000Z"),
    });
    const upsert = vi.fn().mockResolvedValue(undefined);

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant: vi.fn(), findById },
      contactRepository: { findByIds: vi.fn(), listByTenant: vi.fn() },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        findLatestByConversationId,
        findLatestInboundByConversationId,
      },
      readStateRepository: {
        findByConversationId,
        findByConversationIds: vi.fn(),
        upsert,
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    await service.markConversationAsRead("conv-1");

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant.id,
        conversationId: "conv-1",
        operatorId: "operator-1",
        lastReadMessageId: "msg-5",
      })
    );
  });

  it("conversa de outro tenant retorna 404", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const findById = vi.fn().mockResolvedValue(null);
    const upsert = vi.fn();

    const service = new InboxService({
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant: vi.fn(), findById },
      contactRepository: { findByIds: vi.fn(), listByTenant: vi.fn() },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId: vi.fn(),
      },
      readStateRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn(),
        upsert,
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    await expect(service.markConversationAsRead("conv-1")).rejects.toMatchObject<AppError>({
      code: "CONVERSATION_NOT_FOUND",
      statusCode: 404,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("leitura de um operador nao zera para outro", async () => {
    const findByPhoneNumberId = vi.fn().mockResolvedValue(tenant);
    const listByTenant = vi.fn().mockResolvedValue([
      {
        id: "conv-1",
        tenantId: tenant.id,
        contactId: "contact-1",
        status: "open",
        lastMessageAt: new Date("2026-06-12T12:05:00.000Z"),
        createdAt: new Date("2026-06-12T10:00:00.000Z"),
        updatedAt: new Date("2026-06-12T12:05:00.000Z"),
      },
    ]);
    const baseDependencies = {
      tenantRepository: { findByPhoneNumberId },
      conversationRepository: { listByTenant, findById: vi.fn() },
      contactRepository: {
        findByIds: vi.fn().mockResolvedValue([
          {
            id: "contact-1",
            tenantId: tenant.id,
            phone: "5511999999999",
            name: "Maria",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        listByTenant: vi.fn(),
      },
      messageRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn().mockResolvedValue([
          {
            id: "msg-1",
            tenantId: tenant.id,
            conversationId: "conv-1",
            direction: "inbound",
            body: "Oi",
            status: "received",
            externalMessageId: null,
            failureCode: null,
            failureReason: null,
            failedAt: null,
            replyToMessageId: null,
            createdAt: new Date("2026-06-12T10:10:00.000Z"),
            updatedAt: new Date("2026-06-12T10:10:00.000Z"),
          },
        ]),
        findLatestByConversationId: vi.fn(),
        findLatestInboundByConversationId: vi.fn(),
      },
    };

    const operatorOne = new InboxService({
      ...baseDependencies,
      readStateRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn().mockResolvedValue([
          {
            id: "state-1",
            tenantId: tenant.id,
            conversationId: "conv-1",
            operatorId: "operator-1",
            lastReadAt: new Date("2026-06-12T10:30:00.000Z"),
            lastReadMessageId: "msg-1",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        upsert: vi.fn(),
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-1",
      },
    });

    const operatorTwo = new InboxService({
      ...baseDependencies,
      readStateRepository: {
        findByConversationId: vi.fn(),
        findByConversationIds: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-2",
      },
    });

    const [conversationForOperatorOne] = await operatorOne.listConversations();
    const [conversationForOperatorTwo] = await operatorTwo.listConversations();

    expect(conversationForOperatorOne?.unread).toBe(0);
    expect(conversationForOperatorTwo?.unread).toBe(1);
  });
});
