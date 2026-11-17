"use client";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Fetch wrapper for /api/v1 with typed errors carrying the server's Uzbek message. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: opts.signal, credentials: "same-origin" });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("NETWORK", 0, "Internet aloqasi yo‘q. Ulanishni tekshiring.");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && typeof window !== "undefined") {
      const app = window.location.pathname.split("/")[1];
      if (app && ["passenger", "driver", "admin"].includes(app) && !window.location.pathname.endsWith("/login")) window.location.href = `/${app}/login`;
    }
    throw new ApiError(e?.code ?? "HTTP_ERROR", res.status, e?.message ?? "Kutilmagan xatolik.", e?.details);
  }
  return data as T;
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function errorMessage(err: unknown) {
  return err instanceof ApiError ? err.message : "Kutilmagan xatolik yuz berdi.";
}
