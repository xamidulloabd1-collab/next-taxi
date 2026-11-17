import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";

export const GET = route(async () => {
  const ctx = await requireAuth("passenger");
  const user = await db().user.findUniqueOrThrow({ where: { id: ctx.userId }, include: { passengerProfile: true } });
  const p = user.passengerProfile;
  return json({
    id: user.id,
    phone: user.phone,
    fullName: user.fullName,
    rating: p && p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null,
    ridesCount: await db().ride.count({ where: { passengerId: user.id, status: "SETTLED" } }),
    createdAt: user.createdAt,
  });
});

export const PATCH = route(async (req) => {
  const ctx = await requireAuth("passenger");
  const body = await parseJson(req, z.object({ fullName: z.string().trim().min(2).max(80) }));
  const user = await db().user.update({ where: { id: ctx.userId }, data: { fullName: body.fullName } });
  return json({ id: user.id, fullName: user.fullName });
});
