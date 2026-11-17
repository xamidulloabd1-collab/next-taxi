import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import { getPassengerRide, rideTimeline } from "@/features/rides/service";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAuth("passenger");
  const id = uuidSchema.parse((await params).id);
  const ride = await getPassengerRide(ctx.userId, id);
  const timeline = (await rideTimeline(id)).map((e) => ({ status: e.toStatus, at: e.createdAt }));
  return json({ ride, timeline });
});
