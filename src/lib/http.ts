import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { AppError, Errors } from "@/lib/errors";
import { reportError } from "@/lib/monitoring";
import { isUniqueViolation } from "@/lib/db/prisma";

export type RouteContext<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> };

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    const headers: Record<string, string> = {};
    if (err.code === "RATE_LIMITED") headers["retry-after"] = String((err.details as { retryAfterSec?: number })?.retryAfterSec ?? 60);
    return json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status, headers });
  }
  if (err instanceof ZodError) {
    const e = Errors.validation(err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    return json({ error: { code: e.code, message: e.message, details: e.details } }, { status: 422 });
  }
  if (isUniqueViolation(err)) {
    return json({ error: { code: "CONFLICT", message: "Bunday yozuv allaqachon mavjud." } }, { status: 409 });
  }
  reportError(err, { where: "api" });
  // In development show the real cause (e.g. database unreachable); never in production.
  const debug = process.env.NODE_ENV !== "production" ? ` [dev: ${String((err as Error)?.message ?? err).split("\n")[0]!.slice(0, 300)}]` : "";
  return json({ error: { code: "INTERNAL_ERROR", message: `Kutilmagan xatolik yuz berdi. Keyinroq qayta urinib ko‘ring.${debug}` } }, { status: 500 });
}

/**
 * Wraps a route handler with uniform error handling and a same-origin check for
 * state-changing requests (defence in depth on top of SameSite=Lax cookies).
 */
export function route<P extends Record<string, string> = Record<string, string>>(
  fn: (req: NextRequest, ctx: RouteContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (mobile apps, curl) do not send Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw Errors.forbidden("So‘rov manbasi tasdiqlanmadi.");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw Errors.forbidden("So‘rov manbasi tasdiqlanmadi.");
  }
}

export async function parseJson<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 64_000) throw Errors.badRequest("PAYLOAD_TOO_LARGE", "So‘rov hajmi juda katta.");
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw Errors.badRequest("INVALID_JSON", "So‘rov formati noto‘g‘ri.");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T, ZodTypeDef, unknown>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "true") {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real;
  }
  return "local";
}

export function userAgent(req: Request): string | null {
  return req.headers.get("user-agent")?.slice(0, 300) ?? null;
}
