import { AppError } from "../errors/AppError.js";

/** Garante uma invariante de domínio; lança AppError 500 se violada. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AppError({ code: "INVARIANT_VIOLATION", message, statusCode: 500 });
  }
}
