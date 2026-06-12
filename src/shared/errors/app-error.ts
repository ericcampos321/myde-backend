/**
 * Erro de domínio da aplicação. Carrega um código estável e o status HTTP
 * sugerido, permitindo que o handler HTTP traduza sem conhecer o domínio.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(params: {
    code: string;
    message: string;
    statusCode?: number;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.details = params.details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
