import { z } from "zod";
import type { NextRequest } from "next/server";
import { route, json, parseQuery } from "@/lib/http";
import { getAuth } from "@/lib/auth/session";
import { Errors } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { coordinateLabel, getGeocodingProvider } from "@/lib/maps/geocoding";

const schema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

export const GET = route(async (req: NextRequest) => {
  const ctx = (await getAuth("passenger")) ?? (await getAuth("driver"));
  if (!ctx) throw Errors.unauthenticated();
  await enforceRateLimit(`geo-rev:${ctx.userId}`, 30, 60);
  const p = parseQuery(req, schema);
  const label = await getGeocodingProvider().reverse(p);
  return json({ label: label ?? coordinateLabel(p), resolved: Boolean(label) });
});
