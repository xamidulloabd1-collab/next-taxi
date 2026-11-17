import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import { rejectOffer } from "@/features/dispatch/service";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAuth("driver");
  return json({ rejected: await rejectOffer(ctx.userId, uuidSchema.parse((await params).id)) });
});
