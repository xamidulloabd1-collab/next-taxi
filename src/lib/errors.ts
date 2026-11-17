/**
 * Application error with a stable machine-readable code and a user-facing Uzbek message.
 * API responses: { error: { code, message, details? } }
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  unauthenticated: () => new AppError("UNAUTHENTICATED", 401, "Iltimos, tizimga kiring."),
  forbidden: (msg = "Bu amal uchun ruxsatingiz yo‘q.") => new AppError("FORBIDDEN", 403, msg),
  notFound: (what = "Ma’lumot") => new AppError("NOT_FOUND", 404, `${what} topilmadi.`),
  validation: (details?: unknown) => new AppError("VALIDATION_ERROR", 422, "Kiritilgan ma’lumotlar noto‘g‘ri.", details),
  conflict: (code: string, msg: string) => new AppError(code, 409, msg),
  rateLimited: (retryAfterSec: number) =>
    new AppError("RATE_LIMITED", 429, `Juda ko‘p urinish. ${retryAfterSec} soniyadan keyin qayta urinib ko‘ring.`, { retryAfterSec }),
  badRequest: (code: string, msg: string, details?: unknown) => new AppError(code, 400, msg, details),
  unavailable: (code: string, msg: string) => new AppError(code, 503, msg),
};
