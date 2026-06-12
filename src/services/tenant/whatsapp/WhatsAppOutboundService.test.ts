import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WhatsAppOutboundService,
  type MetaOutboundClient,
} from "./WhatsAppOutboundService.js";

/**
 * Testes unitários determinísticos: cobrem as validações que ocorrem ANTES de
 * qualquer acesso ao banco ou à Meta. O cliente Meta é injetado como fake para
 * garantir que ele nunca é chamado quando a validação falha (e nenhuma rede é
 * tocada). A persistência real e o lookup de tenant/conversa são exercidos no
 * teste de integração guardado por RUN_DB_TESTS.
 */
describe("WhatsAppOutboundService (validações pré-persistência)", () => {
  let service: WhatsAppOutboundService;
  let metaClient: MetaOutboundClient;
  let sendText: ReturnType<typeof vi.fn>;

  const VALID_TENANT = "00000000-0000-0000-0000-000000000001";
  const VALID_CONVERSATION = "00000000-0000-0000-0000-000000000002";

  beforeEach(() => {
    sendText = vi.fn();
    metaClient = { sendText };
    service = new WhatsAppOutboundService({ metaClient });
  });

  it("rejeita tenantId vazio sem chamar a Meta", async () => {
    await expect(
      service.sendMessage({
        tenantId: "",
        conversationId: VALID_CONVERSATION,
        text: "teste",
      })
    ).rejects.toMatchObject({ code: "TENANT_ID_REQUIRED" });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("rejeita conversationId vazio sem chamar a Meta", async () => {
    await expect(
      service.sendMessage({
        tenantId: VALID_TENANT,
        conversationId: "",
        text: "teste",
      })
    ).rejects.toMatchObject({ code: "CONVERSATION_ID_REQUIRED" });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("rejeita texto vazio (apenas espaços) sem chamar a Meta", async () => {
    await expect(
      service.sendMessage({
        tenantId: VALID_TENANT,
        conversationId: VALID_CONVERSATION,
        text: "   ",
      })
    ).rejects.toMatchObject({ code: "MESSAGE_TEXT_REQUIRED" });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("rejeita texto maior que 4096 caracteres sem chamar a Meta", async () => {
    await expect(
      service.sendMessage({
        tenantId: VALID_TENANT,
        conversationId: VALID_CONVERSATION,
        text: "x".repeat(4097),
      })
    ).rejects.toMatchObject({ code: "MESSAGE_TEXT_TOO_LONG" });
    expect(sendText).not.toHaveBeenCalled();
  });
});