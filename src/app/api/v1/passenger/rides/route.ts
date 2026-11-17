import { z } from "zod";
import type { NextRequest } from "next/server";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { withIdempotency } from "@/lib/idempotency";
import { createRide, getPassengerRide, listPassengerRides } from "@/features/rides/service";

const schema = z.object({ quoteId: z.string().uuid(), note: z.string().trim().max(300).nullish(), paymentMethod: z.literal("CASH").default("CASH") });

/** Books a ride. Send an `Idempotency-Key` header so network retries never create duplicates. */
export const POST = route(async (req) => {
  const ctx = await requireAuth("passenger");
  await enforceRateLimit(`ride-create:${ctx.userId}`, 10, 300);
  const body = await parseJson(req, schema);
  return withIdempotency(req, ctx.userId, "passenger.rides.create", body, async () => {
    const ride = await createRide(ctx.userId, { quoteId: body.quoteId, note: body.note });
    return { status: 201, body: { ride: await getPassengerRide(ctx.userId, ride.id) } };
  });
});

export const GET = route(async (req: NextRequest) => {
  const ctx = await requireAuth("passenger");
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  return json(await listPassengerRides(ctx.userId, 20, cursor && z.string().uuid().safeParse(cursor).success ? cursor : undefined));
});
