import type { FareQuote, Prisma, VehicleClass } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import { haversineMeters, type LatLng } from "@/lib/maps/geo";
import { getRoutingProvider } from "@/lib/maps/routing";
import { calculateFare } from "@/features/pricing/fare";
import { resolveTripEligibility } from "@/features/zones/service";

export const MIN_TRIP_METERS = 150;
export const MAX_TRIP_METERS = 80_000;

export interface QuoteInput {
  pickup: LatLng & { address?: string | null };
  dropoff: LatLng & { address?: string | null };
  vehicleClass?: VehicleClass;
}

export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = { ECONOMY: "Ekonom", COMFORT: "Komfort" };

/**
 * Creates one server-side fare quote per active tariff class (or only the requested class).
 * The route is computed on the server; the client never supplies distance, duration or price.
 */
export async function createQuotes(passengerId: string, input: QuoteInput): Promise<FareQuote[]> {
  const straight = haversineMeters(input.pickup, input.dropoff);
  if (straight < MIN_TRIP_METERS) throw Errors.badRequest("TRIP_TOO_SHORT", "Olib ketish va borish manzillari juda yaqin.");

  const { city, zoneId } = await resolveTripEligibility(input.pickup, input.dropoff);
  const tariffs = await db().tariff.findMany({
    where: { cityId: city.id, isActive: true, ...(input.vehicleClass ? { vehicleClass: input.vehicleClass } : {}) },
    orderBy: { vehicleClass: "asc" },
  });
  if (tariffs.length === 0) throw Errors.unavailable("NO_TARIFF", "Bu hudud uchun tarif sozlanmagan.");

  const route = await getRoutingProvider().route(input.pickup, input.dropoff);
  if (route.distanceMeters > MAX_TRIP_METERS) throw Errors.badRequest("TRIP_TOO_LONG", "Masofa juda uzoq.");

  const quotes: FareQuote[] = [];
  for (const t of tariffs) {
    const fare = calculateFare(t, route.distanceMeters, route.durationSeconds);
    quotes.push(
      await db().fareQuote.create({
        data: {
          passengerId,
          cityId: city.id,
          zoneId,
          tariffId: t.id,
          tariffVersion: t.version,
          vehicleClass: t.vehicleClass,
          pickupLat: input.pickup.lat,
          pickupLng: input.pickup.lng,
          pickupAddress: input.pickup.address?.slice(0, 200) ?? null,
          dropoffLat: input.dropoff.lat,
          dropoffLng: input.dropoff.lng,
          dropoffAddress: input.dropoff.address?.slice(0, 200) ?? null,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          routeProvider: route.estimated ? `${route.provider}:estimated` : route.provider,
          routeGeometry: (route.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
          baseFare: fare.baseFare,
          distanceFare: fare.distanceFare,
          timeFare: fare.timeFare,
          totalFare: fare.totalFare,
          commissionBps: t.commissionBps,
          expiresAt: new Date(Date.now() + t.quoteTtlSeconds * 1000),
        },
      }),
    );
  }
  return quotes;
}

export function quoteDto(q: FareQuote) {
  return {
    id: q.id,
    vehicleClass: q.vehicleClass,
    vehicleClassLabel: VEHICLE_CLASS_LABELS[q.vehicleClass],
    distanceMeters: q.distanceMeters,
    durationSeconds: q.durationSeconds,
    routeEstimated: q.routeProvider.endsWith(":estimated"),
    routeGeometry: q.routeGeometry,
    breakdown: { baseFare: q.baseFare, distanceFare: q.distanceFare, timeFare: q.timeFare },
    totalFare: q.totalFare,
    currency: q.currency,
    tariffVersion: q.tariffVersion,
    expiresAt: q.expiresAt.toISOString(),
  };
}
