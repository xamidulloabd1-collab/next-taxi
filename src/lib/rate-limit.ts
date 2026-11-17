import { db } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";

/**
 * Fixed-window rate limiter stored in PostgreSQL (works across multiple app instances
 * without Redis). One atomic upsert per check.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number) {
  const rows = await db().$queryRaw<{ count: number; reset_at: Date }[]>`
    INSERT INTO rate_limit_buckets (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets.reset_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
      reset_at = CASE WHEN rate_limit_buckets.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit_buckets.reset_at END
    RETURNING count, reset_at`;
  const row = rows[0]!;
  return { allowed: row.count <= limit, count: row.count, resetAt: row.reset_at };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const r = await hitRateLimit(key, limit, windowSeconds);
  if (!r.allowed) {
    const retry = Math.max(1, Math.ceil((r.resetAt.getTime() - Date.now()) / 1000));
    throw Errors.rateLimited(retry);
  }
  return r;
}

export async function purgeExpiredRateLimits() {
  return db().$executeRaw`DELETE FROM rate_limit_buckets WHERE reset_at < now() - interval '1 hour'`;
}
