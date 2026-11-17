import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { decideDriver } from "@/features/admin/service";

export const POST = adminRoute<{ id: string }>("drivers.verify", async (req, meta, p) => {
  const body = await parseJson(req, z.object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().max(300).nullish() }));
  return json({ driver: await decideDriver(meta, uuidSchema.parse(p.id), body.decision, body.reason) });
});
