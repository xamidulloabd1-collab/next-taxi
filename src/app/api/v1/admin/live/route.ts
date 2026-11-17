import { db } from "@/lib/db/prisma";
import { json } from "@/lib/http";
import { adminRoute } from "@/features/admin/guard";
import { PASSENGER_ACTIVE_STATUSES, RIDE_STATUS_LABELS } from "@/features/rides/state-machine";
import { LOCATION_FRESHNESS_SECONDS } from "@/features/dispatch/service";

export const dynamic = "force-dynamic";

/** Live operations snapshot: active rides and online drivers with their last GPS fix. */
export const GET = adminRoute("rides.view", async () => {
  const [rides, drivers] = await Promise.all([
    db().ride.findMany({
      where: { status: { in: [...PASSENGER_ACTIVE_STATUSES, "COMPLETED"] } },
      orderBy: { requestedAt: "desc" },
      take: 200,
      include: { driver: { include: { user: { select: { fullName: true } }, location: true } }, city: { select: { name: true } }, offers: { where: { status: "PENDING" }, select: { id: true } } },
    }),
    db().driverProfile.findMany({
      where: { availability: "ONLINE" },
      include: { user: { select: { fullName: true } }, location: true, vehicles: { where: { isActive: true }, include: { vehicle: { select: { plateNumber: true, model: true } } } } },
      take: 500,
    }),
  ]);
  const busy = new Set(rides.map((r) => r.driverId).filter(Boolean));
  const now = Date.now();
  return json({
    rides: rides.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      statusLabel: RIDE_STATUS_LABELS[r.status],
      city: r.city.name,
      pickup: { lat: r.pickupLat, lng: r.pickupLng, address: r.pickupAddress },
      dropoff: { lat: r.dropoffLat, lng: r.dropoffLng, address: r.dropoffAddress },
      fare: r.quotedFare,
      requestedAt: r.requestedAt,
      pendingOffers: r.offers.length,
      driver: r.driver ? { name: r.driver.user.fullName, location: r.driver.location, gpsStale: !r.driver.location || now - r.driver.location.recordedAt.getTime() > LOCATION_FRESHNESS_SECONDS * 1000 } : null,
    })),
    drivers: drivers.map((d) => ({
      id: d.userId,
      name: d.user.fullName,
      busy: busy.has(d.userId),
      plate: d.vehicles[0]?.vehicle.plateNumber ?? null,
      location: d.location ? { lat: d.location.lat, lng: d.location.lng, recordedAt: d.location.recordedAt } : null,
      gpsStale: !d.location || now - d.location.recordedAt.getTime() > LOCATION_FRESHNESS_SECONDS * 1000,
    })),
    at: new Date().toISOString(),
  });
});
