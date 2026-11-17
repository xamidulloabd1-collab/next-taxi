import { db } from "@/lib/db/prisma";
import { route } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { Errors } from "@/lib/errors";
import { uuidSchema } from "@/lib/validation";
import { getStorage } from "@/lib/storage";

/** A driver may download only their own documents. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAuth("driver");
  const id = uuidSchema.parse((await params).id);
  const doc = await db().driverDocument.findUnique({ where: { id } });
  if (!doc || doc.driverId !== ctx.userId) throw Errors.notFound("Hujjat");
  const file = await getStorage().get(doc.storageKey);
  if (!file) throw Errors.notFound("Fayl");
  return new Response(Buffer.from(file.body), {
    headers: { "content-type": doc.mimeType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline" },
  });
});
