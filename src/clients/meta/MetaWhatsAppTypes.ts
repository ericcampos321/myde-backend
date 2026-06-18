/** Parâmetros para enviar uma mensagem de texto via Meta (mock ou real). */
export interface SendTextParams {
  phoneNumberId: string;
  to: string;
  body: string;
}

/** Resposta de envio no formato da Meta WhatsApp Cloud API. */
export interface SendTextResult {
  externalMessageId: string;
}
