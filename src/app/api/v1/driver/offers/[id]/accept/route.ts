import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import { acceptOffer } from "@/features/dispatch/service";
import { getDriverRide } from "@/features/rides/service";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAuth("driver");
  const ride = await acceptOffer(ctx.userId, uuidSchema.parse((await params).id));
  return json({ ride: await getDriverRide(ctx.userId, ride.id) });
});
