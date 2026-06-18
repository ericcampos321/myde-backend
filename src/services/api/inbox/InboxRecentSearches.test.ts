import { describe, expect, it, vi } from "vitest";
import { InboxService, type InboxServiceDependencies } from "./InboxService.js";

const tenant = {
  id: "tenant-1",
  name: "NeoFibra",
  phoneNumberId: "123456789012345",
  wabaId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createService(overrides: Partial<InboxServiceDependencies> = {}) {
  return new InboxService({
    tenantRepository: {
      findByPhoneNumberId: vi.fn().mockResolvedValue(tenant),
    },
    conversationRepository: {
      findById: vi.fn(),
      findByContactId: vi.fn(),
      listByTenant: vi.fn(),
    },
    contactRepository: {
      findById: vi.fn(),
      findByIds: vi.fn(),
      listByTenant: vi.fn(),
    },
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
    recentSearchRepository: {
      listByOperator: vi.fn().mockResolvedValue([]),
      saveAndTrim: vi.fn(),
      clearByOperator: vi.fn(),
    },
    ...overrides,
  });
}

describe("InboxService recent searches", () => {
  it("retorna vazio inicialmente com tenant e operador atuais", async () => {
    const listByOperator = vi.fn().mockResolvedValue([]);
    const service = createService({
      recentSearchRepository: {
        listByOperator,
        saveAndTrim: vi.fn(),
        clearByOperator: vi.fn(),
      },
    });

    await expect(service.listRecentSearches()).resolves.toEqual([]);
    expect(listByOperator).toHaveBeenCalledWith(tenant.id, "operator-1", 4);
  });

  it("salva conversa do tenant atual e limita a quatro", async () => {
    const saveAndTrim = vi.fn();
    const service = createService({
      conversationRepository: {
        findById: vi.fn().mockResolvedValue({ id: "conv-1", tenantId: tenant.id }),
        findByContactId: vi.fn(),
        listByTenant: vi.fn(),
      },
      recentSearchRepository: {
        listByOperator: vi.fn(),
        saveAndTrim,
        clearByOperator: vi.fn(),
      },
    });

    await service.saveRecentSearch("conversation", "conv-1");

    expect(saveAndTrim).toHaveBeenCalledWith(
      {
        tenantId: tenant.id,
        operatorId: "operator-1",
        targetType: "conversation",
        targetId: "conv-1",
      },
      4
    );
  });

  it("post repetido usa a mesma chave de upsert sem duplicar no contrato", async () => {
    const saveAndTrim = vi.fn();
    const service = createService({
      conversationRepository: {
        findById: vi.fn().mockResolvedValue({ id: "conv-1", tenantId: tenant.id }),
        findByContactId: vi.fn(),
        listByTenant: vi.fn(),
      },
      recentSearchRepository: {
        listByOperator: vi.fn(),
        saveAndTrim,
        clearByOperator: vi.fn(),
      },
    });

    await service.saveRecentSearch("conversation", "conv-1");
    await service.saveRecentSearch("conversation", "conv-1");

    expect(saveAndTrim).toHaveBeenCalledTimes(2);
    expect(saveAndTrim.mock.calls[0]).toEqual(saveAndTrim.mock.calls[1]);
  });

  it("limpa somente recentes do operador atual", async () => {
    const clearByOperator = vi.fn();
    const service = createService({
      recentSearchRepository: {
        listByOperator: vi.fn(),
        saveAndTrim: vi.fn(),
        clearByOperator,
      },
    });

    await service.clearRecentSearches();

    expect(clearByOperator).toHaveBeenCalledWith(tenant.id, "operator-1");
  });

  it("nao permite salvar alvo de outro tenant ou inexistente", async () => {
    const saveAndTrim = vi.fn();
    const service = createService({
      conversationRepository: {
        findById: vi.fn().mockResolvedValue(null),
        findByContactId: vi.fn(),
        listByTenant: vi.fn(),
      },
      recentSearchRepository: {
        listByOperator: vi.fn(),
        saveAndTrim,
        clearByOperator: vi.fn(),
      },
    });

    await expect(
      service.saveRecentSearch("conversation", "other-tenant-conversation")
    ).rejects.toMatchObject({
      code: "RECENT_SEARCH_TARGET_NOT_FOUND",
      statusCode: 404,
    });
    expect(saveAndTrim).not.toHaveBeenCalled();
  });

  it("recentes de um operador nao aparecem para outro", async () => {
    const listByOperator = vi.fn().mockResolvedValue([]);
    const service = createService({
      operatorIdentityResolver: {
        getCurrentOperatorId: () => "operator-2",
      },
      recentSearchRepository: {
        listByOperator,
        saveAndTrim: vi.fn(),
        clearByOperator: vi.fn(),
      },
    });

    await service.listRecentSearches();

    expect(listByOperator).toHaveBeenCalledWith(tenant.id, "operator-2", 4);
  });

  it("monta DTO atual de contato e conversa sem snapshot de mensagem", async () => {
    const updatedAt = new Date("2026-06-14T12:00:00.000Z");
    const service = createService({
      conversationRepository: {
        findById: vi.fn(),
        findByContactId: vi.fn().mockResolvedValue({ id: "conv-1" }),
        listByTenant: vi.fn(),
      },
      contactRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "contact-1",
          tenantId: tenant.id,
          name: "Maria Silva",
          phone: "5511999999999",
        }),
        findByIds: vi.fn(),
        listByTenant: vi.fn(),
      },
      recentSearchRepository: {
        listByOperator: vi.fn().mockResolvedValue([
          {
            id: "recent-1",
            tenantId: tenant.id,
            operatorId: "operator-1",
            targetType: "contact",
            targetId: "contact-1",
            createdAt: updatedAt,
            updatedAt,
          },
        ]),
        saveAndTrim: vi.fn(),
        clearByOperator: vi.fn(),
      },
    });

    await expect(service.listRecentSearches()).resolves.toEqual([
      {
        id: "recent-1",
        targetType: "contact",
        targetId: "contact-1",
        conversationId: "conv-1",
        label: "Maria Silva",
        subtitle: "5511999999999",
        avatarInitials: "MS",
        updatedAt: updatedAt.toISOString(),
        canOpen: true,
      },
    ]);
  });
});
