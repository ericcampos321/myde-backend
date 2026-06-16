import type { AiUsageRecentCursor } from "../../../../types/tenant/ai/AiUsageTypes.js";

interface CursorPayload {
  createdAt: string;
  id: string;
}

export function encodeAiUsageCursor(input: {
  createdAt: Date;
  id: string;
}): string {
  const payload: CursorPayload = {
    createdAt: input.createdAt.toISOString(),
    id: input.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeAiUsageCursor(
  cursor: string | null | undefined
): AiUsageRecentCursor | null {
  if (!cursor) return null;

  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as Partial<CursorPayload>;
    if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
      return null;
    }
    if (typeof payload.createdAt !== "string") {
      return null;
    }

    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }

    return { createdAt, id: payload.id };
  } catch {
    return null;
  }
}
