/**
 * Cursor de paginação do histórico de mensagens.
 *
 * Cursor estável por `(createdAt, id)` (tie-break por id), codificado como string
 * opaca `base64("<epochMs>_<id>")`. Puro e testável — sem dependência de DB.
 */

const DEFAULT_MESSAGE_LIMIT = 30;
const MAX_MESSAGE_LIMIT = 50;

export interface MessageCursor {
  createdAtMs: number;
  id: string;
}

export interface MessageCursorSource {
  createdAt: Date;
  id: string;
}

export function encodeMessageCursor(source: MessageCursorSource): string {
  const payload = `${source.createdAt.getTime()}_${source.id}`;
  return Buffer.from(payload, "utf8").toString("base64");
}

export function decodeMessageCursor(
  cursor: string | undefined | null
): MessageCursor | null {
  if (typeof cursor !== "string" || cursor.length === 0) {
    return null;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64").toString("utf8");
  } catch {
    return null;
  }

  // Formato: "<epochMs>_<uuid>". O id pode conter "_"? UUIDs não contêm "_",
  // então o primeiro "_" separa createdAtMs do id com segurança.
  const separatorIndex = decoded.indexOf("_");
  if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) {
    return null;
  }

  const createdAtMs = Number(decoded.slice(0, separatorIndex));
  const id = decoded.slice(separatorIndex + 1);

  if (!Number.isFinite(createdAtMs) || createdAtMs < 0 || id.length === 0) {
    return null;
  }

  return { createdAtMs, id };
}

/**
 * Clampa o limite vindo do cliente: default 30, máximo 50.
 * NaN/inválido/`< 1` → default.
 */
export function clampMessageLimit(raw: unknown): number {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;

  if (!Number.isFinite(value) || value < 1) {
    return DEFAULT_MESSAGE_LIMIT;
  }

  return Math.min(Math.floor(value), MAX_MESSAGE_LIMIT);
}

export const MESSAGE_PAGE_LIMITS = {
  default: DEFAULT_MESSAGE_LIMIT,
  max: MAX_MESSAGE_LIMIT,
} as const;
