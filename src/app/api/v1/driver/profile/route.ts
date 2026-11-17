import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { getDriverOverview, updateDriverProfile } from "@/features/drivers/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requireAuth("driver");
  return json({ driver: await getDriverOverview(ctx.userId) });
});

const schema = z.object({
  fullName: z.string().trim().min(5, "To‘liq F.I.Sh. kiriting").max(80),
  cityId: z.string().uuid(),
  licenseNumber: z.string().trim().min(6).max(20),
  licenseExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const PUT = route(async (req) => {
  const ctx = await requireAuth("driver");
  const body = await parseJson(req, schema);
  return json({ driver: await updateDriverProfile(ctx.userId, body) });
});
