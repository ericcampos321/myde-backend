import { env } from "../../../config/env.js";

/**
 * Placeholder único para identidade do operador enquanto a inbox ainda não
 * roda com autenticação real. Quando auth existir, este resolver vira o ponto
 * de integração sem espalhar operatorId fixo pelo código.
 */
export class InboxOperatorIdentityResolver {
  getCurrentOperatorId(): string {
    return env.INBOX_OPERATOR_ID ?? "inbox-default-operator";
  }
}
