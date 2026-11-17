import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { reviewDocument } from "@/features/admin/service";

export const POST = adminRoute<{ id: string }>("drivers.verify", async (req, meta, p) => {
  const body = await parseJson(req, z.object({ status: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(300).nullish() }));
  const d = await reviewDocument(meta, uuidSchema.parse(p.id), body.status, body.reason);
  return json({ document: { id: d.id, status: d.status } });
});
