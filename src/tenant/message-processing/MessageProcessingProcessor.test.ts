import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../shared/logger/logger.js";
import { createMessageProcessingProcessor } from "./index.js";

describe("MessageProcessingProcessor", () => {
  it("retorna processed true quando mensagem e conversa existem", async () => {
    const processor = createMessageProcessingProcessor({
      messageRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "message-1",
          tenantId: "tenant-1",
        }),
      },
      conversationRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "conversation-1",
          tenantId: "tenant-1",
        }),
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
    });
  });

  it("retorna skipped quando mensagem nao existe", async () => {
    const processor = createMessageProcessingProcessor({
      messageRepository: {
        findById: vi.fn().mockResolvedValue(null),
      },
      conversationRepository: {
        findById: vi.fn(),
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
