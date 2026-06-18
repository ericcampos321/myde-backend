/**
 * Helpers puros para validar/limitar a consulta de uso da IA — evitam query
 * pesada (janela e limite clampeados) e datas inválidas. Sem dependência de DB.
 */

export const AI_USAGE = {
  defaultLimit: 20,
  maxLimit: 100,
  defaultWindowDays: 7,
  maxWindowDays: 90,
} as const;

export const AI_USAGE_SOURCES = ["openai", "stub"] as const;
export const AI_USAGE_RISK_LEVELS = ["low", "medium", "high"] as const;
export const AI_USAGE_STAGES = [
  "input",
  "output",
  "recurring",
  "auto_reply",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function clampUsageLimit(raw: unknown): number {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < 1) return AI_USAGE.defaultLimit;
  return Math.min(Math.floor(value), AI_USAGE.maxLimit);
}

export function parseUsageBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

export function parseUsageEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as T[number])
    : null;
}

export function parseUsageTextFilter(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/** Parse de data ISO/`YYYY-MM-DD`; inválida → null. */
export function parseUsageDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve a janela [from, to): default últimos 7 dias; `to` default = agora;
 * janela máxima de 90 dias (recorta `from`); garante `from < to`.
 */
export function resolveUsageWindow(
  input: { from?: unknown; to?: unknown },
  now: Date = new Date()
): { from: Date; to: Date } {
  const to = parseUsageDate(input.to) ?? now;
  let from =
    parseUsageDate(input.from) ??
    new Date(to.getTime() - AI_USAGE.defaultWindowDays * DAY_MS);

  if (from.getTime() >= to.getTime()) {
    from = new Date(to.getTime() - AI_USAGE.defaultWindowDays * DAY_MS);
  }

  const maxSpan = AI_USAGE.maxWindowDays * DAY_MS;
  if (to.getTime() - from.getTime() > maxSpan) {
    from = new Date(to.getTime() - maxSpan);
  }

  return { from, to };
}
