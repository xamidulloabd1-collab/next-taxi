import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { adminRoute } from "@/features/admin/guard";
import { staffReply } from "@/features/support/service";

export const POST = adminRoute<{ id: string }>("support.manage", async (req, meta, p) => {
  const id = uuidSchema.parse(p.id);
  const body = await parseJson(req, z.object({ body: z.string().trim().min(1).max(2000), status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional() }));
  const r = await staffReply(meta.ctx.userId, id, body.body, body.status);
  await audit({ actorId: meta.ctx.userId, action: "support.reply", entityType: "support_ticket", entityId: id, before: { status: r.before.status }, after: { status: body.status }, ip: meta.ip, userAgent: meta.userAgent });
  return json({ ok: true }, { status: 201 });
});
