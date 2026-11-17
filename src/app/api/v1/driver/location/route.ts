import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { updateDriverLocation } from "@/features/drivers/service";

const schema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  heading: z.number().min(0).max(360).nullish(),
  speedKmh: z.number().min(0).max(250).nullish(),
  accuracyM: z.number().min(0).max(10000).nullish(),
  recordedAt: z.string().datetime().nullish(),
});

export const POST = route(async (req) => {
  const ctx = await requireAuth("driver");
  return json(await updateDriverLocation(ctx.userId, await parseJson(req, schema)));
});
