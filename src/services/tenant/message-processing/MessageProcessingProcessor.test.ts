import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../shared/logger/logger.js";
import { createMessageProcessingProcessor } from "./index.js";

describe("MessageProcessingProcessor", () => {
  it("retorna processed true quando mensagem e conversa existem", async () => {
    const generateResponse = vi.fn().mockResolvedValue({
      text: "Temos Fibra Start 300 Mbps por R$ 79,90.",
      source: "stub",
    });

    const processor = createMessageProcessingProcessor({
      messageRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "message-1",
          tenantId: "tenant-1",
          direction: "inbound",
          body: "Quais planos voces tem?",
        }),
        findByConversationId: vi.fn().mockResolvedValue([
          {
            id: "message-0",
            tenantId: "tenant-1",
            direction: "outbound",
            body: "Ola! Como posso ajudar?",
          },
          {
            id: "message-1",
            tenantId: "tenant-1",
            direction: "inbound",
            body: "Quais planos voces tem?",
          },
        ]),
      },
      conversationRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "conversation-1",
          tenantId: "tenant-1",
        }),
      },
      aiResponseService: {
        generateResponse,
      },
      log: createLogger({ test: "processor" }),
    });

    const result = await processor.processMessageJob({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      externalMessageId: "wamid.test-1",
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
    });

    expect(result).toEqual({
      processed: true,
      messageId: "message-1",
      conversationId: "conversation-1",
      aiResponseText: "Temos Fibra Start 300 Mbps por R$ 79,90.",
      aiSource: "stub",
    });
    expect(generateResponse).toHaveBeenCalledWith({
      currentMessage: "Quais planos voces tem?",
      conversationHistory: [
        {
          direction: "outbound",
          body: "Ola! Como posso ajudar?",
        },
      ],
    });
  });

  function buildProcessorWithAutoReply(opts: {
    autoReplyEnabled: boolean;
    outboundService: { sendMessage: ReturnType<typeof vi.fn> };
    aiText?: string;
    direction?: string;
  }) {
    return createMessageProcessingProcessor({
      messageRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "message-1",
          tenantId: "tenant-1",
          direction: opts.direction ?? "inbound",
          body: "oi",
        }),
        findByConversationId: vi.fn().mockResolvedValue([
          { id: "message-1", tenantId: "tenant-1", direction: "inbound", body: "oi" },
        ]),
      },
      conversationRepository: {
        findById: vi.fn().mockResolvedValue({ id: "conversation-1", tenantId: "tenant-1" }),
      },
      aiResponseService: {
        generateResponse: vi.fn().mockResolvedValue({
          text: opts.aiText ?? "Olá! Como posso ajudar?",
          source: "stub",
        }),
      },
      log: createLogger({ test: "processor" }),
      autoReplyEnabled: opts.autoReplyEnabled,
      outboundService: opts.outboundService,
    });
  }

  const job = {
    tenantId: "tenant-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    externalMessageId: "wamid.test-1",
    phoneNumberId: "123456789012345",
    contactPhone: "5511999990000",
  };

  it("auto-reply DESLIGADO: não chama outbound", async () => {
    const sendMessage = vi.fn();
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: false,
      outboundService: { sendMessage },
    });

    const result = await processor.processMessageJob(job);

    expect(result.processed).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("auto-reply LIGADO: envia outbound uma vez com replyToMessageId", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
    });

    await processor.processMessageJob(job);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      text: "Olá! Como posso ajudar?",
      replyToMessageId: "message-1",
    });
  });

  it("auto-reply LIGADO mas IA vazia: não envia outbound", async () => {
    const sendMessage = vi.fn();
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
      aiText: "   ",
    });

    const result = await processor.processMessageJob(job);

    expect(result.processed).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("auto-reply LIGADO mas mensagem é outbound: não responde a si mesmo", async () => {
    const sendMessage = vi.fn();
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
      direction: "outbound",
    });

    await processor.processMessageJob(job);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("auto-reply LIGADO: erro da Meta é propagado para o job falhar/retry", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Falha ao enviar pela Meta"), {
          code: "META_SEND_MESSAGE_FAILED",
        })
      );
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
    });

    await expect(processor.processMessageJob(job)).rejects.toMatchObject({
      code: "META_SEND_MESSAGE_FAILED",
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("anti-loop: from === display_phone_number (normalizado) NÃO envia", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
    });

    // mesmo número, formatações diferentes (com +, espaços e hífen)
    const result = await processor.processMessageJob({
      ...job,
      contactPhone: "+55 15 99127-0311",
      displayPhoneNumber: "5515991270311",
    });

    expect(result.processed).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("anti-loop: from !== display_phone_number envia normalmente", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
    });

    await processor.processMessageJob({
      ...job,
      contactPhone: "5511999990000",
      displayPhoneNumber: "5515991270311",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("anti-loop: display_phone_number ausente não bloqueia indevidamente", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
    });

    // sem displayPhoneNumber (undefined) → não pode bloquear
    await processor.processMessageJob({ ...job, displayPhoneNumber: undefined });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("anti-loop: phoneNumberId NÃO é tratado como telefone real", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
    });

    // phoneNumberId igual ao contactPhone, mas sem display_phone_number:
    // como a guarda só compara contra display_phone_number, deve ENVIAR.
    await processor.processMessageJob({
      ...job,
      contactPhone: "5511999990000",
      phoneNumberId: "5511999990000",
      displayPhoneNumber: undefined,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("retorna skipped quando mensagem nao existe", async () => {
    const processor = createMessageProcessingProcessor({
      messageRepository: {
        findById: vi.fn().mockResolvedValue(null),
        findByConversationId: vi.fn(),
      },
      conversationRepository: {
        findById: vi.fn(),
      },
      aiResponseService: {
        generateResponse: vi.fn(),
      },
      log: createLogger({ test: "processor" }),
    });

    const result = await processor.processMessageJob({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageId: "message-404",
      externalMessageId: "wamid.test-404",
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
    });

    expect(result).toEqual({
      processed: false,
      skipped: true,
      reason: "message_not_found",
      messageId: "message-404",
      conversationId: "conversation-1",
    });
  });
});
