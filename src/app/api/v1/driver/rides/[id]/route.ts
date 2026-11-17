import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import { getDriverRide } from "@/features/rides/service";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAuth("driver");
  return json({ ride: await getDriverRide(ctx.userId, uuidSchema.parse((await params).id)) });
});
