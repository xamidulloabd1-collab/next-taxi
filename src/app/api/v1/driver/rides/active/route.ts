import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { getActiveDriverRide } from "@/features/rides/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requireAuth("driver");
  return json({ ride: await getActiveDriverRide(ctx.userId) });
});
