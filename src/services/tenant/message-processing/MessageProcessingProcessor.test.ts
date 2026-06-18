import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../shared/logger/logger.js";
import { GUARDRAIL_BLOCKED_RESPONSE } from "../ai/guardrails/AiGuardrailResponses.js";
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
        findRecentByConversationId: vi.fn().mockResolvedValue([
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
      interactionLogService: { record: vi.fn() },
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
    record?: ReturnType<typeof vi.fn>;
    countRecentHighRisk?: ReturnType<typeof vi.fn>;
    generateResponse?: ReturnType<typeof vi.fn>;
    safetyGuard?: {
      analyzeInput: ReturnType<typeof vi.fn>;
    };
  }) {
    return createMessageProcessingProcessor({
      messageRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "message-1",
          tenantId: "tenant-1",
          direction: opts.direction ?? "inbound",
          body: "oi",
        }),
        findRecentByConversationId: vi.fn().mockResolvedValue([
          { id: "message-1", tenantId: "tenant-1", direction: "inbound", body: "oi" },
        ]),
      },
      conversationRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "conversation-1",
          tenantId: "tenant-1",
          contactId: "contact-1",
        }),
      },
      aiResponseService: {
        generateResponse:
          opts.generateResponse ??
          vi.fn().mockResolvedValue({
            text: opts.aiText ?? "Olá! Como posso ajudar?",
            source: "stub",
          }),
      },
      interactionLogService: {
        record: opts.record ?? vi.fn(),
        ...(opts.countRecentHighRisk
          ? { countRecentHighRisk: opts.countRecentHighRisk }
          : {}),
      },
      safetyGuard: opts.safetyGuard,
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

  it("auto-reply bloqueado por guardrail: não chama IA, registra auditoria e envia alerta sem retry", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ id: "out-guardrail" });
    const record = vi.fn();
    const countRecentHighRisk = vi.fn().mockResolvedValue(0);
    const generateResponse = vi.fn();
    const safetyGuard = {
      analyzeInput: vi.fn().mockReturnValue({
        action: "block",
        riskLevel: "high",
        riskReasons: ["prompt_injection", "secret_exfiltration"],
        matchedRules: [
          "prompt_injection_ignore_previous_instructions",
          "secret_extraction_sensitive_credentials",
        ],
        blocked: true,
      }),
    };
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
      record,
      countRecentHighRisk,
      generateResponse,
      safetyGuard,
    });

    const result = await processor.processMessageJob(job);

    expect(generateResponse).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      text: GUARDRAIL_BLOCKED_RESPONSE,
      replyToMessageId: "message-1",
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "auto_reply",
        action: "block",
        riskLevel: "high",
        riskReasons: ["prompt_injection", "secret_exfiltration"],
        blocked: true,
        source: null,
        provider: null,
        model: null,
        outputCharCount: GUARDRAIL_BLOCKED_RESPONSE.length,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      })
    );
    expect(result).toEqual({
      processed: true,
      messageId: "message-1",
      conversationId: "conversation-1",
      aiResponseText: GUARDRAIL_BLOCKED_RESPONSE,
    });
  });

  it("auto-reply bloqueado por guardrail não entra em retry se envio do alerta falhar", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("meta down"));
    const generateResponse = vi.fn();
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
      generateResponse,
      safetyGuard: {
        analyzeInput: vi.fn().mockReturnValue({
          action: "block",
          riskLevel: "high",
          riskReasons: ["prompt_injection"],
          matchedRules: ["prompt_injection_ignore_previous_instructions"],
          blocked: true,
        }),
      },
    });

    await expect(processor.processMessageJob(job)).resolves.toMatchObject({
      processed: true,
      aiResponseText: GUARDRAIL_BLOCKED_RESPONSE,
    });
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it("auto-reply LIGADO mas IA vazia: skipped empty_ai_response, não envia", async () => {
    const sendMessage = vi.fn();
    const processor = buildProcessorWithAutoReply({
      autoReplyEnabled: true,
      outboundService: { sendMessage },
      aiText: "   ",
    });

    const result = await processor.processMessageJob(job);

    expect(result).toMatchObject({ skipped: true, reason: "empty_ai_response" });
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

    expect(result).toMatchObject({ skipped: true, reason: "anti_loop" });
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

  describe("human takeover (operador respondeu manualmente)", () => {
    const INBOUND_TIME = new Date("2026-01-01T10:00:00.000Z");
    const inbound = {
      id: "message-1",
      tenantId: "tenant-1",
      direction: "inbound",
      body: "quais planos?",
      replyToMessageId: null,
      createdAt: INBOUND_TIME,
    };

    function build(opts: {
      conversationMessages: Array<Record<string, unknown>>;
      sendMessage: ReturnType<typeof vi.fn>;
      generateResponse?: ReturnType<typeof vi.fn>;
    }) {
      const findRecentByConversationId = vi
        .fn()
        .mockResolvedValue(opts.conversationMessages);
      const generateResponse =
        opts.generateResponse ??
        vi.fn().mockResolvedValue({ text: "resposta IA", source: "stub" });
      const processor = createMessageProcessingProcessor({
        messageRepository: {
          findById: vi.fn().mockResolvedValue(inbound),
          findRecentByConversationId,
        },
        conversationRepository: {
          findById: vi
            .fn()
            .mockResolvedValue({
              id: "conversation-1",
              tenantId: "tenant-1",
              contactId: "contact-1",
            }),
        },
        aiResponseService: { generateResponse },
        interactionLogService: { record: vi.fn() },
        log: createLogger({ test: "takeover" }),
        autoReplyEnabled: true,
        outboundService: { sendMessage: opts.sendMessage },
      });
      return { processor, findRecentByConversationId, generateResponse };
    }

    const job = {
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      externalMessageId: "wamid.in-1",
      phoneNumberId: "123456789012345",
      contactPhone: "5511999990000",
    };

    function out(overrides: Record<string, unknown>) {
      return {
        id: "out-x",
        tenantId: "tenant-1",
        direction: "outbound",
        body: "...",
        replyToMessageId: null,
        createdAt: new Date("2026-01-01T10:05:00.000Z"),
        ...overrides,
      };
    }

    it("(a) sem outbound manual: auto-reply envia", async () => {
      const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
      const { processor } = build({
        conversationMessages: [inbound],
        sendMessage,
      });

      await processor.processMessageJob(job);

      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it("(b) com outbound manual posterior: NÃO envia e NÃO chama a IA", async () => {
      const sendMessage = vi.fn();
      const generateResponse = vi.fn();
      const { processor } = build({
        conversationMessages: [
          inbound,
          out({ id: "manual-1", replyToMessageId: null }), // manual, depois do inbound
        ],
        sendMessage,
        generateResponse,
      });

      const result = await processor.processMessageJob(job);

      expect(result).toMatchObject({
        processed: false,
        skipped: true,
        reason: "manually_answered",
      });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(generateResponse).not.toHaveBeenCalled(); // economiza OpenAI
    });

    it("(c) com outbound manual ANTERIOR ao inbound: auto-reply ainda envia", async () => {
      const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
      const { processor } = build({
        conversationMessages: [
          out({
            id: "manual-old",
            replyToMessageId: null,
            createdAt: new Date("2026-01-01T09:00:00.000Z"), // antes do inbound
          }),
          inbound,
        ],
        sendMessage,
      });

      await processor.processMessageJob(job);

      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it("(d) auto-reply já existente para o inbound: NÃO conta como manual, mas idempotência (already_auto_replied) impede reenvio", async () => {
      const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
      const { processor } = build({
        conversationMessages: [
          inbound,
          out({ id: "auto-1", replyToMessageId: "message-1" }), // auto-reply DESTE inbound
        ],
        sendMessage,
      });

      const result = await processor.processMessageJob(job);

      // Não é "manually_answered" (auto-reply não é manual); é idempotência:
      // já existe resposta automática para este inbound (ex.: retry do job).
      expect(result).toMatchObject({
        skipped: true,
        reason: "already_auto_replied",
      });
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("(b2) operador responde DURANTE a IA: chama IA mas NÃO envia (2ª checagem)", async () => {
      const sendMessage = vi.fn();
      const generateResponse = vi
        .fn()
        .mockResolvedValue({ text: "resposta IA", source: "stub" });
      // 1ª busca (pré-IA): sem manual → IA roda. 2ª busca (pré-envio): manual
      // surgiu durante a geração → bloqueia o envio.
      const findRecentByConversationId = vi
        .fn()
        .mockResolvedValueOnce([inbound])
        .mockResolvedValueOnce([
          inbound,
          out({ id: "manual-mid", replyToMessageId: null }),
        ]);
      const processor = createMessageProcessingProcessor({
        messageRepository: {
          findById: vi.fn().mockResolvedValue(inbound),
          findRecentByConversationId,
        },
        conversationRepository: {
          findById: vi
            .fn()
            .mockResolvedValue({
              id: "conversation-1",
              tenantId: "tenant-1",
              contactId: "contact-1",
            }),
        },
        aiResponseService: { generateResponse },
        interactionLogService: { record: vi.fn() },
        log: createLogger({ test: "takeover" }),
        autoReplyEnabled: true,
        outboundService: { sendMessage },
      });

      const result = await processor.processMessageJob(job);

      expect(generateResponse).toHaveBeenCalledTimes(1); // IA foi chamada
      expect(sendMessage).not.toHaveBeenCalled(); // mas não enviou
      expect(result).toMatchObject({
        processed: false,
        skipped: true,
        reason: "manually_answered",
      });
      expect(findRecentByConversationId).toHaveBeenCalledTimes(2); // double-check
    });

    it("(e) checagem é tenant+conversa-scoped (usa findRecentByConversationId com o tenantId)", async () => {
      const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
      const { processor, findRecentByConversationId } = build({
        conversationMessages: [inbound],
        sendMessage,
      });

      await processor.processMessageJob(job);

      expect(findRecentByConversationId).toHaveBeenCalledWith(
        "tenant-1",
        "conversation-1",
        50
      );
    });
  });

  describe("registro de uso da IA (controle de custo)", () => {
    const aiWithUsage = () =>
      vi.fn().mockResolvedValue({
        text: "Temos o plano Start por R$ 79,90.",
        source: "openai",
        model: "gpt-4o-mini",
        usage: {
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
        },
        contextItemsCount: 3,
        contextChars: 2048,
      });

    it("registra uso seguro com stage auto_reply e metadados completos", async () => {
      const record = vi.fn();
      const processor = buildProcessorWithAutoReply({
        autoReplyEnabled: true,
        outboundService: { sendMessage: vi.fn().mockResolvedValue({ id: "out-1" }) },
        record,
        generateResponse: aiWithUsage(),
      });

      await processor.processMessageJob(job);

      expect(record).toHaveBeenCalledTimes(1);
      const logged = record.mock.calls[0]![0];
      expect(logged).toMatchObject({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        contactId: "contact-1",
        stage: "auto_reply",
        action: "allow",
        riskLevel: "low",
        blocked: false,
        source: "openai",
        provider: "openai",
        model: "gpt-4o-mini",
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        contextItemsCount: 3,
        contextChars: 2048,
        inputCharCount: 2, // "oi"
        outputCharCount: "Temos o plano Start por R$ 79,90.".length,
      });
      expect(logged.durationMs).toEqual(expect.any(Number));
      expect(logged.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("NÃO persiste prompt, mensagem ou resposta crua (apenas metadados)", async () => {
      const record = vi.fn();
      const processor = buildProcessorWithAutoReply({
        autoReplyEnabled: true,
        outboundService: { sendMessage: vi.fn().mockResolvedValue({ id: "out-1" }) },
        record,
        generateResponse: aiWithUsage(),
      });

      await processor.processMessageJob(job);

      const logged = record.mock.calls[0]![0];
      const serialized = JSON.stringify(logged);
      // Sem texto do usuário, sem resposta da IA, sem prompt/system prompt.
      expect(serialized).not.toContain("oi");
      expect(serialized).not.toContain("Temos o plano Start");
      expect(Object.keys(logged)).not.toContain("text");
      expect(Object.keys(logged)).not.toContain("prompt");
      expect(Object.keys(logged)).not.toContain("systemPrompt");
    });

    it("usage ausente: tokens nulos e fluxo não quebra", async () => {
      const record = vi.fn();
      const processor = buildProcessorWithAutoReply({
        autoReplyEnabled: true,
        outboundService: { sendMessage: vi.fn().mockResolvedValue({ id: "out-1" }) },
        record,
        // sem usage/model/context
        generateResponse: vi
          .fn()
          .mockResolvedValue({ text: "Olá!", source: "stub" }),
      });

      const result = await processor.processMessageJob(job);

      expect(result.processed).toBe(true);
      const logged = record.mock.calls[0]![0];
      expect(logged).toMatchObject({
        stage: "auto_reply",
        source: "stub",
        model: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        contextItemsCount: null,
        contextChars: null,
      });
    });

    it("registra uso mesmo com auto-reply DESLIGADO (a IA é chamada)", async () => {
      const record = vi.fn();
      const processor = buildProcessorWithAutoReply({
        autoReplyEnabled: false,
        outboundService: { sendMessage: vi.fn() },
        record,
        generateResponse: aiWithUsage(),
      });

      await processor.processMessageJob(job);

      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]![0]).toMatchObject({ stage: "auto_reply" });
    });

    it("falha ao registrar log NÃO derruba a resposta automática", async () => {
      const record = vi.fn().mockRejectedValue(new Error("db down"));
      const sendMessage = vi.fn().mockResolvedValue({ id: "out-1" });
      const processor = buildProcessorWithAutoReply({
        autoReplyEnabled: true,
        outboundService: { sendMessage },
        record,
        generateResponse: aiWithUsage(),
      });

      const result = await processor.processMessageJob(job);

      expect(result.processed).toBe(true);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  it("retorna skipped quando mensagem nao existe", async () => {
    const processor = createMessageProcessingProcessor({
      messageRepository: {
        findById: vi.fn().mockResolvedValue(null),
        findRecentByConversationId: vi.fn(),
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
