import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { uuidSchema, reasonSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { adminRoute } from "@/features/admin/guard";
import { adminCancelRide, adminCompleteRide, adminConfirmCash } from "@/features/rides/service";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: reasonSchema }),
  z.object({ action: z.literal("complete"), reason: reasonSchema }),
  z.object({ action: z.literal("confirm-cash"), reason: reasonSchema }),
]);

/** Operator interventions (e.g. driver's phone died mid-trip). Every action is audited with a reason. */
export const POST = adminRoute<{ id: string }>("rides.manage", async (req, meta, p) => {
  const id = uuidSchema.parse(p.id);
  const body = await parseJson(req, schema);
  const staffId = meta.ctx.userId;
  const ride =
    body.action === "cancel"
      ? (await adminCancelRide(staffId, id, body.reason)).after
      : body.action === "complete"
        ? await adminCompleteRide(staffId, id)
        : await adminConfirmCash(staffId, id);
  await audit({ actorId: staffId, action: `ride.admin.${body.action}`, entityType: "ride", entityId: id, after: { status: ride.status, reason: body.reason }, ip: meta.ip, userAgent: meta.userAgent });
  return json({ ride: { id: ride.id, status: ride.status } });
});
