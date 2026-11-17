import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { setDriverSuspension } from "@/features/admin/service";

export const POST = adminRoute<{ id: string }>("drivers.manage", async (req, meta, p) => {
  const body = await parseJson(req, z.object({ suspend: z.boolean(), reason: z.string().trim().max(300).nullish() }));
  return json({ driver: await setDriverSuspension(meta, uuidSchema.parse(p.id), body.suspend, body.reason) });
});
