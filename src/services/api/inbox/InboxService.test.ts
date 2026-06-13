import { describe, it, expect, vi } from "vitest";
import { InboxService } from "./InboxService.js";

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
      },
    });

    await expect(service.listContacts()).resolves.toEqual([]);
    expect(listByTenant).toHaveBeenCalledWith(tenant.id, undefined);
  });
});
