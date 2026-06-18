/**
 * Helpers puros da busca de mensagens dentro da conversa.
 *
 * Sem regex pesada, sem dependência de DB. O cursor reusa o formato da paginação
 * (`inboxMessageCursor.ts`).
 */

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_PREVIEW_MAX = 200;
const SEARCH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface SearchDateRange {
  start: Date;
  end: Date;
}

/**
 * Converte `YYYY-MM-DD` em um intervalo diário UTC [início, próximo dia).
 * Retorna null para formato ou data de calendário inválidos.
 */
export function parseSearchDate(
  value: string | null | undefined
): SearchDateRange | null {
  if (!value || !SEARCH_DATE_PATTERN.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, day!));

  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== month! - 1 ||
    start.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    start,
    end: new Date(Date.UTC(year!, month! - 1, day! + 1)),
  };
}

/**
 * Escapa os caracteres especiais de LIKE/ILIKE (`\`, `%`, `_`) para que o termo
 * do usuário seja tratado como literal — evita wildcard involuntário.
 * Usar com `ILIKE ... ESCAPE '\'`. A barra é escapada PRIMEIRO.
 */
export function escapeLikeSearchTerm(term: string): string {
  return term
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

/** Clampa o limite da busca: default 20, máx 50; NaN/inválido/`< 1` → default. */
export function clampSearchLimit(raw: unknown): number {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;

  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.min(Math.floor(value), MAX_SEARCH_LIMIT);
}

export interface BodyPreview {
  bodyPreview: string;
  matchedText: string | null;
}

/**
 * Monta um preview do corpo ao redor da primeira ocorrência do termo
 * (case-insensitive, via `indexOf` — sem regex). Janela de `max` chars com
 * reticências quando truncado. Sem match → trecho inicial truncado.
 */
export function buildBodyPreview(
  body: string,
  term: string,
  max = DEFAULT_PREVIEW_MAX
): BodyPreview {
  const trimmedTerm = term.trim();
  const matchIndex =
    trimmedTerm.length > 0
      ? body.toLowerCase().indexOf(trimmedTerm.toLowerCase())
      : -1;

  if (body.length <= max) {
    return {
      bodyPreview: body,
      matchedText:
        matchIndex >= 0 ? body.slice(matchIndex, matchIndex + trimmedTerm.length) : null,
    };
  }

  if (matchIndex < 0) {
    return { bodyPreview: `${body.slice(0, max)}…`, matchedText: null };
  }

  // Centraliza a janela no match.
  const half = Math.floor((max - trimmedTerm.length) / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(body.length, start + max);
  const adjustedStart = Math.max(0, end - max);

  const slice = body.slice(adjustedStart, end);
  const bodyPreview = `${adjustedStart > 0 ? "…" : ""}${slice}${
    end < body.length ? "…" : ""
  }`;

  return {
    bodyPreview,
    matchedText: body.slice(matchIndex, matchIndex + trimmedTerm.length),
  };
}

export const MESSAGE_SEARCH = {
  minTermLength: 2,
  maxTermLength: 80,
  defaultLimit: DEFAULT_SEARCH_LIMIT,
  maxLimit: MAX_SEARCH_LIMIT,
} as const;
