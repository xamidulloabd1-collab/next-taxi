import { z } from "zod";
import type { NextRequest } from "next/server";
import { route, json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { listDriverRides } from "@/features/rides/service";

export const GET = route(async (req: NextRequest) => {
  const ctx = await requireAuth("driver");
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  return json(await listDriverRides(ctx.userId, 20, cursor && z.string().uuid().safeParse(cursor).success ? cursor : undefined));
});
