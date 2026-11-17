import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema, reasonSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { setUserBlocked } from "@/features/admin/service";

export const POST = adminRoute<{ id: string }>("passengers.manage", async (req, meta, p) => {
  const body = await parseJson(req, z.object({ blocked: z.boolean(), reason: reasonSchema }));
  const u = await setUserBlocked(meta, uuidSchema.parse(p.id), body.blocked, body.reason);
  return json({ user: { id: u.id, status: u.status } });
});
