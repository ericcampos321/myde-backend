import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import { createLogger } from "../../shared/logger/logger.js";
import type { SendTextParams, SendTextResult } from "./MetaWhatsAppTypes.js";

const log = createLogger({ module: "meta-graph-api" });

/** Mascara o telefone para logs (LGPD): mantém só os 4 últimos dígitos. */
function maskPhone(phone: string): string {
  if (phone.length <= 4) {
    return "****";
  }
  return `****${phone.slice(-4)}`;
}

interface MetaGraphApiErrorResponse {
  error?: {
    code: number;
    message: string;
    error_subcode?: number;
  };
  errors?: Array<{
    code: number;
    message: string;
  }>;
}

interface MetaGraphApiSuccessResponse {
  messages?: Array<{
    id: string;
    message_status: string;
  }>;
  message_status?: string;
  contacts?: Array<{
    input: string;
    wa_id: string;
  }>;
}

export class MetaGraphApiClient {
  private apiBaseUrl: string;
  private accessToken: string;

  constructor() {
    if (!env.META_API_BASE_URL) {
      throw new AppError({
        code: "META_API_BASE_URL_NOT_CONFIGURED",
        message: "META_API_BASE_URL não configurado. Configure a URL base da Graph API no .env.",
        statusCode: 500,
      });
    }

    if (!env.META_TOKEN) {
      throw new AppError({
        code: "META_TOKEN_NOT_CONFIGURED",
        message:
          "META_TOKEN não configurado. Configure o token de acesso da Meta no .env.",
        statusCode: 500,
      });
    }

    if (!env.META_PHONE_NUMBER_ID) {
      throw new AppError({
        code: "META_PHONE_NUMBER_ID_NOT_CONFIGURED",
        message:
          "META_PHONE_NUMBER_ID não configurado. Configure o ID do número de teste da Meta no .env.",
        statusCode: 500,
      });
    }

    this.apiBaseUrl = env.META_API_BASE_URL;
    this.accessToken = env.META_TOKEN;
  }

  /**
   * Envia uma mensagem de texto via Meta WhatsApp Cloud API.
   * Retorna o externalMessageId da Meta.
   */
  async sendText(params: SendTextParams): Promise<SendTextResult> {
    const url = `${this.apiBaseUrl}/${params.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      text: {
        body: params.body,
      },
    };

    log.info(
      {
        to: maskPhone(params.to),
        bodyLength: params.body.length,
      },
      "[meta] sending text message"
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | MetaGraphApiSuccessResponse
        | MetaGraphApiErrorResponse;

      if (!response.ok) {
        const errorMsg =
          (data as MetaGraphApiErrorResponse).error?.message ||
          (data as MetaGraphApiErrorResponse).errors?.[0]?.message ||
          `HTTP ${response.status}`;

        log.error(
          {
            to: maskPhone(params.to),
            status: response.status,
            errorMessage: errorMsg,
          },
          "[meta] send message failed"
        );

        throw new AppError({
          code: "META_SEND_MESSAGE_FAILED",
          message: `Falha ao enviar mensagem pela Meta: ${errorMsg}`,
          statusCode: 500,
        });
      }

      const successData = data as MetaGraphApiSuccessResponse;
      const externalMessageId = successData.messages?.[0]?.id;

      if (!externalMessageId) {
        log.error(
          {
            to: maskPhone(params.to),
            hasMessages: Array.isArray(successData.messages),
          },
          "[meta] send message succeeded but no message id in response"
        );

        throw new AppError({
          code: "META_SEND_MESSAGE_FAILED",
          message: "Resposta da Meta não contém message ID.",
          statusCode: 500,
        });
      }

      log.info(
        {
          to: maskPhone(params.to),
          externalMessageId,
        },
        "[meta] message sent successfully"
      );

      return { externalMessageId };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      log.error(
        {
          to: maskPhone(params.to),
          error: error instanceof Error ? error.message : "unknown",
        },
        "[meta] unexpected error sending message"
      );

      throw new AppError({
        code: "META_SEND_MESSAGE_FAILED",
        message:
          "Erro ao comunicar com a Meta. Tente novamente mais tarde.",
        statusCode: 500,
      });
    }
  }
}

export function createMetaGraphApiClient(): MetaGraphApiClient {
  return new MetaGraphApiClient();
}
