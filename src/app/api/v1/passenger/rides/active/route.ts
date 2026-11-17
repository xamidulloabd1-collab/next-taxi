import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { getActivePassengerRide } from "@/features/rides/service";

export const dynamic = "force-dynamic";

/** Current ride (if any) — used to restore state after refresh or reconnect. */
export const GET = route(async () => {
  const ctx = await requireAuth("passenger");
  return json({ ride: await getActivePassengerRide(ctx.userId) });
});
