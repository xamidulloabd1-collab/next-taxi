import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { getPendingOffer } from "@/features/drivers/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requireAuth("driver");
  return json({ offer: await getPendingOffer(ctx.userId), serverTime: new Date().toISOString() });
});
