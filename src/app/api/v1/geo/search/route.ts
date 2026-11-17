import { z } from "zod";
import type { NextRequest } from "next/server";
import { route, json, parseQuery } from "@/lib/http";
import { getAuth } from "@/lib/auth/session";
import { Errors } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getGeocodingProvider } from "@/lib/maps/geocoding";

const schema = z.object({ q: z.string().trim().min(2).max(100), lat: z.coerce.number().optional(), lng: z.coerce.number().optional() });

/** Address search proxied through the configured geocoder (keeps provider keys server-side). */
export const GET = route(async (req: NextRequest) => {
  const ctx = (await getAuth("passenger")) ?? (await getAuth("driver"));
  if (!ctx) throw Errors.unauthenticated();
  await enforceRateLimit(`geo:${ctx.userId}`, 30, 60);
  const q = parseQuery(req, schema);
  const provider = getGeocodingProvider();
  const results = await provider.search(q.q, q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null);
  return json({ provider: provider.name, results });
});
