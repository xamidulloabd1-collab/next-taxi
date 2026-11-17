import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { adminRoute } from "@/features/admin/guard";
import { saveZone } from "@/features/admin/service";

const schema = z.object({
  id: z.string().uuid().optional(),
  cityId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  boundary: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }),
  isActive: z.boolean().default(true),
  note: z.string().trim().max(500).nullish(),
});

export const POST = adminRoute("cities.manage", async (req, meta) => {
  const zone = await saveZone(meta, await parseJson(req, schema));
  return json({ zone: { id: zone.id, name: zone.name, isActive: zone.isActive } }, { status: 201 });
});
