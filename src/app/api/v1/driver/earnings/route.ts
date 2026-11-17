import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { db } from "@/lib/db/prisma";
import { driverEarnings } from "@/features/drivers/service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const ctx = await requireAuth("driver");
  const profile = await db().driverProfile.findUnique({ where: { userId: ctx.userId }, include: { city: true } });
  const settlements = await db().settlement.findMany({ where: { driverId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 20 });
  return json({
    ...(await driverEarnings(ctx.userId, profile?.city?.timezone ?? "Asia/Tashkent")),
    maxDebt: profile?.city?.maxDriverDebt ?? null,
    settlements: settlements.map((s) => ({ id: s.id, amount: s.amount, method: s.method, createdAt: s.createdAt })),
  });
});
