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
