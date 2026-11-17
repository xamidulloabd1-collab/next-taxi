import { db } from "@/lib/db/prisma";
import { route, json } from "@/lib/http";
import { VEHICLE_CLASS_LABELS } from "@/features/pricing/service";
import { env } from "@/lib/env";
import { getSetting } from "@/features/settings/service";

export const dynamic = "force-dynamic";

/** Public service-area configuration for the map (active cities, zones, tariffs). */
export const GET = route(async () => {
  const cities = await db().city.findMany({
    where: { status: "ACTIVE" },
    include: { zones: { where: { isActive: true }, select: { id: true, name: true, boundary: true } }, tariffs: { where: { isActive: true } } },
    orderBy: { name: "asc" },
  });
  return json({
    cities: cities.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      center: c.centerLat != null && c.centerLng != null ? { lat: c.centerLat, lng: c.centerLng } : null,
      zoom: c.defaultZoom,
      operatingHours: { start: c.operatingHoursStart, end: c.operatingHoursEnd, timezone: c.timezone },
      zones: c.zones,
      tariffs: c.tariffs.map((t) => ({ vehicleClass: t.vehicleClass, label: VEHICLE_CLASS_LABELS[t.vehicleClass], baseFare: t.baseFare, perKm: t.perKm, perMinute: t.perMinute, minimumFare: t.minimumFare })),
    })),
    features: { geocoding: env().GEOCODING_PROVIDER !== "none", routingEstimated: env().ROUTING_PROVIDER === "estimate" },
    supportPhone: await getSetting<string>("support_phone", ""),
    cancelReasons: await getSetting<string[]>("passenger_cancel_reasons", []),
    allCities: await db().city.findMany({ select: { id: true, name: true, region: true, status: true }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
  });
});
