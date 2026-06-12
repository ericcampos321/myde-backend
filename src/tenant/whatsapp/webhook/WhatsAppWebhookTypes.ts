/**
 * Representação normalizada de uma mensagem inbound, extraída do payload da
 * Meta pelo WhatsAppPayloadMapper (implementado no commit do webhook).
 */
export interface NormalizedInboundMessage {
  phoneNumberId: string;
  wabaId: string;
  externalMessageId: string;
  from: string;
  contactName: string | null;
  text: string;
  timestamp: string;
}
