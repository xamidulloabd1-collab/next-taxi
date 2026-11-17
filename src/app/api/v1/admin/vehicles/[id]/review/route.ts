import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { reviewVehicle } from "@/features/admin/service";

export const POST = adminRoute<{ id: string }>("vehicles.verify", async (req, meta, p) => {
  const body = await parseJson(req, z.object({ status: z.enum(["APPROVED", "REJECTED", "INACTIVE"]), reason: z.string().trim().max(300).nullish() }));
  return json({ vehicle: await reviewVehicle(meta, uuidSchema.parse(p.id), body.status, body.reason) });
});
