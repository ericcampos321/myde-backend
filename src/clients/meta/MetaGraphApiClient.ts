import { env, autoReplyEnabled } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import { createLogger } from "../../shared/logger/logger.js";
import { maskPhone } from "../../shared/utils/phone.js";
import type { SendTextParams, SendTextResult } from "./MetaWhatsAppTypes.js";

const log = createLogger({ module: "meta-graph-api" });

/** Classifica o destino do envio para diagnóstico (mock vs real vs custom). */
export function metaModeOf(baseUrl: string): "mock" | "real" | "custom" {
  const u = baseUrl.toLowerCase();
  if (u.includes("mock-meta") || u.includes("localhost:8001") || u.includes("127.0.0.1:8001")) {
    return "mock";
  }
  if (u.includes("graph.facebook.com")) {
    return "real";
  }
  return "custom";
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid-url";
  }
}

interface MetaGraphApiErrorResponse {
  error?: {
    code: number;
    message: string;
    type?: string;
    error_subcode?: number;
    fbtrace_id?: string;
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

    // Log seguro de configuração (sem token): deixa explícito se o outbound vai
    // para o mock ou para a Meta real — diagnóstico do "aparece no inbox mas não
    // chega no WhatsApp" (tipicamente metaMode=mock).
    log.info(
      {
        metaMode: metaModeOf(this.apiBaseUrl),
        baseUrlHost: hostOf(this.apiBaseUrl),
        phoneNumberId: env.META_PHONE_NUMBER_ID,
        autoReplyEnabled,
      },
      "[meta] outbound client configured"
    );
  }

  /**
   * Envia uma mensagem de texto via Meta WhatsApp Cloud API.
   * Retorna o externalMessageId da Meta.
   */
  async sendText(params: SendTextParams): Promise<SendTextResult> {
    const url = `${this.apiBaseUrl}/${params.phoneNumberId}/messages`;

    // Contrato IDÊNTICO ao do envio direto que funciona (Graph API v25):
    // inclui recipient_type=individual e text.preview_url=false explícitos.
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "text",
      text: {
        preview_url: false,
        body: params.body,
      },
    } as const;

    const baseUrlHost = hostOf(this.apiBaseUrl);
    const metaMode = metaModeOf(this.apiBaseUrl);

    log.info(
      {
        metaMode,
        baseUrlHost,
        phoneNumberId: params.phoneNumberId,
        to: maskPhone(params.to),
        bodyLength: params.body.length,
        payloadKeys: {
          messaging_product: payload.messaging_product,
          recipient_type: payload.recipient_type,
          to: maskPhone(payload.to),
          type: payload.type,
          "text.preview_url": payload.text.preview_url,
          "text.bodyExists": payload.text.body.length > 0,
        },
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

        const metaError = (data as MetaGraphApiErrorResponse).error;
        log.error(
          {
            metaMode,
            baseUrlHost,
            phoneNumberId: params.phoneNumberId,
            to: maskPhone(params.to),
            status: response.status,
            errorCode: metaError?.code,
            errorType: metaError?.type,
            errorSubcode: metaError?.error_subcode,
            fbtraceId: metaError?.fbtrace_id,
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
          metaMode,
          baseUrlHost,
          phoneNumberId: params.phoneNumberId,
          to: maskPhone(params.to),
          status: response.status,
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
