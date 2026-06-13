import { describe, expect, it } from "vitest";
import { WhatsAppPayloadMapper } from "./WhatsAppPayloadMapper.js";

describe("WhatsAppPayloadMapper", () => {
  const mapper = new WhatsAppPayloadMapper();

  it("extrai uma mensagem text da Meta", () => {
    const result = mapper.map({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TESTE_0001",
          changes: [
            {
              value: {
                metadata: {
                  phone_number_id: "123456789012345",
                  display_phone_number: "+55 15 99127-0311",
                },
                contacts: [
                  {
                    profile: { name: "Cliente Teste" },
                    wa_id: "5511999990000",
                  },
                ],
                messages: [
                  {
                    from: "5511999990000",
                    id: "wamid.mapper-1",
                    timestamp: "1760000000",
                    type: "text",
                    text: { body: "Quais sao os planos?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      kind: "message",
      message: {
        phoneNumberId: "123456789012345",
        displayPhoneNumber: "+55 15 99127-0311",
        wabaId: "WABA_TESTE_0001",
        externalMessageId: "wamid.mapper-1",
        contactPhone: "5511999990000",
        contactName: "Cliente Teste",
        text: "Quais sao os planos?",
        timestamp: new Date(1760000000 * 1000),
      },
    });
  });

  it("mapeia displayPhoneNumber como null quando ausente no metadata", () => {
    const result = mapper.map({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TESTE_0002",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123456789012345" },
                contacts: [{ wa_id: "5511988887777" }],
                messages: [
                  {
                    from: "5511988887777",
                    id: "wamid.mapper-2",
                    timestamp: "1760000000",
                    type: "text",
                    text: { body: "oi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      kind: "message",
      message: { displayPhoneNumber: null, phoneNumberId: "123456789012345" },
    });
  });

  it("ignora evento sem mensagem text", () => {
    expect(mapper.map({ entry: [{ changes: [{ value: {} }] }] })).toEqual({
      kind: "ignored",
      reason: "unsupported_event",
    });
  });

  it("mapeia evento de statuses[] como kind:status (não unsupported)", () => {
    const result = mapper.map({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TESTE_0001",
          changes: [
            {
              field: "messages",
              value: {
                metadata: {
                  phone_number_id: "123456789012345",
                  display_phone_number: "5515991270311",
                },
                statuses: [
                  {
                    id: "wamid.outbound-1",
                    status: "delivered",
                    timestamp: "1760000000",
                    recipient_id: "5511999990000",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      kind: "status",
      phoneNumberId: "123456789012345",
      statuses: [
        {
          messageId: "wamid.outbound-1",
          status: "delivered",
          recipientId: "5511999990000",
          timestamp: "1760000000",
          errorCode: null,
          errorTitle: null,
          errorMessage: null,
          errorDetails: null,
        },
      ],
    });
  });

  it("mapeia status failed com code/title/message/details e recipient_id", () => {
    const result = mapper.map({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TESTE_0001",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123456789012345" },
                statuses: [
                  {
                    id: "wamid.outbound-2",
                    status: "failed",
                    recipient_id: "5514991270311",
                    timestamp: "1760000123",
                    errors: [
                      {
                        code: 131026,
                        title: "Message undeliverable",
                        message: "Message Undeliverable.",
                        error_data: {
                          details:
                            "Message could not be delivered. The recipient may not have WhatsApp or has not accepted the new terms.",
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      kind: "status",
      phoneNumberId: "123456789012345",
      statuses: [
        {
          messageId: "wamid.outbound-2",
          status: "failed",
          recipientId: "5514991270311",
          timestamp: "1760000123",
          errorCode: 131026,
          errorTitle: "Message undeliverable",
          errorMessage: "Message Undeliverable.",
          errorDetails:
            "Message could not be delivered. The recipient may not have WhatsApp or has not accepted the new terms.",
        },
      ],
    });
  });
});
