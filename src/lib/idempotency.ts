import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, isUniqueViolation } from "@/lib/db/prisma";
import { AppError, Errors } from "@/lib/errors";
import { json } from "@/lib/http";

/**
 * Idempotent POST handling via the `Idempotency-Key` header. The first request with a key
 * runs and its successful response is stored; retries with the same key and body replay the
 * stored response; a different body with the same key is rejected. Failed requests release the key.
 */
export async function withIdempotency(
  req: Request,
  userId: string,
  endpoint: string,
  body: unknown,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const key = req.headers.get("idempotency-key");
  if (!key) {
    const r = await run();
    return json(r.body, { status: r.status });
  }
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw Errors.badRequest("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key formati noto‘g‘ri.");
  const requestHash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");

  let recordId: string;
  try {
    recordId = (await db().idempotencyKey.create({ data: { userId, key, endpoint, requestHash } })).id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await db().idempotencyKey.findUnique({ where: { userId_endpoint_key: { userId, endpoint, key } } });
    if (!existing) throw err;
    if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED", 422, "Bu so‘rov kaliti boshqa ma’lumot bilan ishlatilgan.");
    if (existing.responseStatus == null) throw Errors.conflict("REQUEST_IN_PROGRESS", "So‘rov bajarilmoqda. Biroz kuting.");
    return json(existing.responseBody, { status: existing.responseStatus, headers: { "idempotent-replay": "true" } });
  }

  try {
    const r = await run();
    await db().idempotencyKey.update({
      where: { id: recordId },
      data: { responseStatus: r.status, responseBody: JSON.parse(JSON.stringify(r.body)) as Prisma.InputJsonValue },
    });
    return json(r.body, { status: r.status });
  } catch (err) {
    await db().idempotencyKey.delete({ where: { id: recordId } }).catch(() => undefined);
    throw err;
  }
}
