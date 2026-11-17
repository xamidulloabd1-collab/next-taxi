import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { submitForReview } from "@/features/drivers/service";

export const POST = route(async () => {
  const ctx = await requireAuth("driver");
  return json({ driver: await submitForReview(ctx.userId) });
});
