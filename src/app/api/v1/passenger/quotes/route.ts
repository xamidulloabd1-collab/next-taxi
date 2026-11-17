import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { placeSchema } from "@/lib/validation";
import { createQuotes, quoteDto } from "@/features/pricing/service";

const schema = z.object({ pickup: placeSchema, dropoff: placeSchema, vehicleClass: z.enum(["ECONOMY", "COMFORT"]).optional() });

/** Server-side fare quote(s) for every available class. Client-supplied prices are never accepted. */
export const POST = route(async (req) => {
  const ctx = await requireAuth("passenger");
  await enforceRateLimit(`quote:${ctx.userId}`, 30, 60);
  const body = await parseJson(req, schema);
  const quotes = await createQuotes(ctx.userId, body);
  return json({ quotes: quotes.map(quoteDto) }, { status: 201 });
});
