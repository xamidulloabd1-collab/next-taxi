import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import { cancelRideByPassenger, getPassengerRide } from "@/features/rides/service";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAuth("passenger");
  const id = uuidSchema.parse((await params).id);
  const body = await parseJson(req, z.object({ reason: z.string().trim().max(200).nullish() }));
  await cancelRideByPassenger(ctx.userId, id, body.reason);
  return json({ ride: await getPassengerRide(ctx.userId, id) });
});
