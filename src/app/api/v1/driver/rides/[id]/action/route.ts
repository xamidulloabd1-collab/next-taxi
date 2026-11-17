import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import {
  DRIVER_CANCEL_REASONS,
  driverArrived,
  driverCancelRide,
  driverCompleteRide,
  driverConfirmCash,
  driverEnRoute,
  driverStartRide,
  getDriverRide,
  type DriverCancelReason,
} from "@/features/rides/service";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("en-route") }),
  z.object({ action: z.literal("arrived") }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("cash-confirm") }),
  z.object({ action: z.literal("cancel"), reason: z.enum(Object.keys(DRIVER_CANCEL_REASONS) as [DriverCancelReason, ...DriverCancelReason[]]) }),
]);

/** Driver ride lifecycle actions; every transition is validated by the server-side state machine. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAuth("driver");
  const id = uuidSchema.parse((await params).id);
  const body = await parseJson(req, schema);
  switch (body.action) {
    case "en-route":
      await driverEnRoute(ctx.userId, id);
      break;
    case "arrived":
      await driverArrived(ctx.userId, id);
      break;
    case "start":
      await driverStartRide(ctx.userId, id);
      break;
    case "complete":
      await driverCompleteRide(ctx.userId, id);
      break;
    case "cash-confirm":
      await driverConfirmCash(ctx.userId, id);
      break;
    case "cancel": {
      const ride = await driverCancelRide(ctx.userId, id, body.reason);
      return json({ ride: null, outcome: ride.status });
    }
  }
  return json({ ride: await getDriverRide(ctx.userId, id) });
});
