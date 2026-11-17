import { db } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import { uuidSchema } from "@/lib/validation";
import { getStorage } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { adminRoute } from "@/features/admin/guard";

/** Streams a private driver document to authorised reviewers; every view is audited. */
export const GET = adminRoute<{ id: string }>("documents.view", async (_req, meta, p) => {
  const doc = await db().driverDocument.findUnique({ where: { id: uuidSchema.parse(p.id) } });
  if (!doc) throw Errors.notFound("Hujjat");
  const file = await getStorage().get(doc.storageKey);
  if (!file) throw Errors.notFound("Fayl");
  await audit({ actorId: meta.ctx.userId, action: "document.view", entityType: "driver_document", entityId: doc.id, ip: meta.ip, userAgent: meta.userAgent });
  return new Response(Buffer.from(file.body), {
    headers: { "content-type": doc.mimeType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline", "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" },
  });
});
