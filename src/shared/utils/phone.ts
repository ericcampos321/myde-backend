/**
 * Mascara um telefone para uso em logs (LGPD): mantém apenas os 4 últimos
 * dígitos. Nunca usar o valor mascarado para enviar à Meta — só para log.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) {
    return "****";
  }
  if (phone.length <= 4) {
    return "****";
  }
  return `****${phone.slice(-4)}`;
}

/**
 * Normaliza um telefone para comparação: remove tudo que não for dígito
 * (espaços, `+`, hífens, parênteses, etc.). Retorna "" para entradas vazias.
 * Use apenas para COMPARAR números — não para enviar à Meta.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) {
    return "";
  }
  return phone.replace(/\D/g, "");
}

/**
 * Indica se dois telefones representam o mesmo número após normalização.
 * Retorna false se algum estiver vazio (evita falso-positivo por "" === "").
 */
export function samePhoneNumber(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length > 0 && na === nb;
}
