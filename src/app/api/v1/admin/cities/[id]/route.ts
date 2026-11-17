import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { updateCity } from "@/features/admin/service";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  centerLat: z.number().min(-90).max(90).nullable().optional(),
  centerLng: z.number().min(-180).max(180).nullable().optional(),
  defaultZoom: z.number().min(8).max(18).optional(),
  operatingHoursStart: hhmm.optional(),
  operatingHoursEnd: hhmm.optional(),
  searchRadiusMeters: z.number().int().min(300).max(50000).optional(),
  offerTimeoutSeconds: z.number().int().min(8).max(120).optional(),
  offerBatchSize: z.number().int().min(1).max(5).optional(),
  maxOffersPerRide: z.number().int().min(1).max(50).optional(),
  searchTimeoutSeconds: z.number().int().min(30).max(1800).optional(),
  maxDriverDebt: z.number().int().min(0).max(100_000_000).optional(),
});

export const PATCH = adminRoute<{ id: string }>("cities.manage", async (req, meta, p) => {
  return json({ city: await updateCity(meta, uuidSchema.parse(p.id), await parseJson(req, schema)) });
});
