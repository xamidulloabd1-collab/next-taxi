import { db } from "@/lib/db/prisma";
import { json } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { getStorage } from "@/lib/storage";
import { adminRoute } from "@/features/admin/guard";
import { anonymizeUser } from "@/features/privacy/service";

/** Account deletion request (user asked via support). SUPER_ADMIN only; irreversible. */
export const POST = adminRoute<{ id: string }>("staff.manage", async (_req, meta, p) => {
  const id = uuidSchema.parse(p.id);
  const docs = await anonymizeUser(id, meta.ctx.userId, { ip: meta.ip, userAgent: meta.userAgent });
  for (const d of docs) await getStorage().delete(d.storageKey);
  await db().driverDocument.deleteMany({ where: { driverId: id } });
  return json({ ok: true, documentsDeleted: docs.length });
});
