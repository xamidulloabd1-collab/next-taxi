import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { setAvailability } from "@/features/drivers/service";

export const POST = route(async (req) => {
  const ctx = await requireAuth("driver");
  const { online } = await parseJson(req, z.object({ online: z.boolean() }));
  return json({ availability: await setAvailability(ctx.userId, online) });
});
