import { createHmac, timingSafeEqual } from "node:crypto";

/** Calcula `sha256=<hex>` no formato do header X-Hub-Signature-256 da Meta. */
export function hmacSha256Hex(rawBody: Buffer | string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Compara duas assinaturas em tempo constante.
 * Retorna false se os tamanhos diferirem (evita throw do timingSafeEqual).
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
