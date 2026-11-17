import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { updateIncident } from "@/features/admin/service";

export const PATCH = adminRoute<{ id: string }>("incidents.manage", async (req, meta, p) => {
  const body = await parseJson(req, z.object({ status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED"]), resolution: z.string().trim().max(2000).nullish() }));
  return json({ incident: await updateIncident(meta, uuidSchema.parse(p.id), body.status, body.resolution) });
});
