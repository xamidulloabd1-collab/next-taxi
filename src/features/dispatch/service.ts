import type { City, Ride, VehicleClass } from "@prisma/client";
import { db, withTransaction, isUniqueViolation } from "@/lib/db/prisma";
import { AppError, Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/monitoring";
import { getRoutingProvider } from "@/lib/maps/routing";
import { publish, STAFF_AUDIENCE } from "@/lib/realtime/events";
import { applyTransition, lockRide, notifyRide } from "@/features/rides/core";

/** A driver location older than this is treated as "disconnected" and is not dispatched. */
export const LOCATION_FRESHNESS_SECONDS = 60;
/** Online drivers silent for this long are switched offline by the dispatch tick. */
export const STALE_DRIVER_OFFLINE_SECONDS = 10 * 60;

export interface Candidate {
  driverId: string;
  vehicleId: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

/**
 * Eligible drivers near the pickup, nearest first (PostGIS ST_DWithin on a GiST index).
 * Eligibility: approved & active account, ONLINE, same city, approved active vehicle of the
 * requested class, fresh GPS, no active or unsettled ride, no pending offer, not previously
 * offered this ride, and commission debt within the city limit.
 */
export async function findCandidates(ride: Pick<Ride, "id" | "cityId" | "pickupLat" | "pickupLng" | "vehicleClass">, radiusMeters: number, limit: number): Promise<Candidate[]> {
  const cls: VehicleClass = ride.vehicleClass;
  // The spatial search runs first (GiST index, materialised) and the eligibility checks join by
  // primary key afterwards. Measured on 2,000 online drivers: 38 ms vs 1.2 s for a single flat query,
  // whose plan underestimated the spatial filter and nested-looped sequential scans.
  const rows = await db().$queryRaw<{ driver_id: string; vehicle_id: string; lat: number; lng: number; distance_m: number }[]>`
    WITH pickup AS (SELECT ST_SetSRID(ST_MakePoint(${ride.pickupLng}, ${ride.pickupLat}), 4326)::geography AS g),
    near AS MATERIALIZED (
      SELECT dl.driver_id, dl.lat, dl.lng, ST_Distance(dl.geog, pickup.g)::float8 AS distance_m
        FROM driver_locations dl, pickup
       WHERE dl.recorded_at > now() - make_interval(secs => ${LOCATION_FRESHNESS_SECONDS})
         AND ST_DWithin(dl.geog, pickup.g, ${radiusMeters})
    )
    SELECT near.driver_id::text AS driver_id, v.id::text AS vehicle_id, near.lat, near.lng, near.distance_m
      FROM near
      JOIN driver_profiles dp ON dp.user_id = near.driver_id
      JOIN cities c ON c.id = dp.city_id
      JOIN users u ON u.id = dp.user_id
      JOIN driver_vehicles dv ON dv.driver_id = dp.user_id AND dv.is_active
      JOIN vehicles v ON v.id = dv.vehicle_id
     WHERE dp.status = 'APPROVED'
       AND dp.availability = 'ONLINE'
       AND dp.city_id = ${ride.cityId}::uuid
       AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       AND v.status = 'APPROVED' AND v.vehicle_class = ${cls}::"VehicleClass"
       AND NOT EXISTS (
             SELECT 1 FROM rides r
              WHERE r.driver_id = dp.user_id
                AND r.status IN ('ASSIGNED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'))
       AND NOT EXISTS (
             SELECT 1 FROM ride_offers o
              WHERE o.driver_id = dp.user_id AND (o.ride_id = ${ride.id}::uuid OR o.status = 'PENDING'))
       AND COALESCE((
             SELECT SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
               FROM ledger_entries le
              WHERE le.driver_id = dp.user_id AND le.account = 'DRIVER_COMMISSION_RECEIVABLE'), 0) <= c.max_driver_debt
     ORDER BY near.distance_m ASC
     LIMIT ${limit}`;
  return rows.map((r) => ({ driverId: r.driver_id, vehicleId: r.vehicle_id, lat: r.lat, lng: r.lng, distanceMeters: Math.round(r.distance_m) }));
}

export type DispatchOutcome = "OFFERED" | "WAITING" | "NO_DRIVER" | "SKIPPED";

function searchDeadline(ride: Ride, city: City) {
  return (ride.searchStartedAt ?? ride.requestedAt).getTime() + city.searchTimeoutSeconds * 1000;
}

/**
 * Advances dispatch for a ride: sends expiring offers to the best-ranked eligible drivers
 * (up to the city's batch size), or ends the search with NO_DRIVER when the policy is exhausted.
 * Safe to call concurrently and repeatedly (row lock + partial unique indexes).
 */
export async function dispatchRide(rideId: string): Promise<DispatchOutcome> {
  const ride = await db().ride.findUnique({ where: { id: rideId }, include: { city: true } });
  if (!ride || ride.status !== "SEARCHING") return "SKIPPED";
  const city = ride.city;
  const now = Date.now();

  const [pending, total] = await Promise.all([
    db().rideOffer.count({ where: { rideId, status: "PENDING", expiresAt: { gt: new Date() } } }),
    db().rideOffer.count({ where: { rideId } }),
  ]);
  const exhausted = total >= city.maxOffersPerRide || now > searchDeadline(ride, city);
  if (exhausted) {
    if (pending === 0) return (await markNoDriver(rideId)) ? "NO_DRIVER" : "SKIPPED";
    return "WAITING";
  }
  const slots = Math.min(city.offerBatchSize - pending, city.maxOffersPerRide - total);
  if (slots <= 0) return "WAITING";

  const candidates = await findCandidates(ride, city.searchRadiusMeters, slots * 3);
  if (candidates.length === 0) return "WAITING"; // the dispatch tick retries until the search deadline

  // Rank by road ETA when a routing provider is available, distance as tie-breaker.
  let etas: number[];
  try {
    etas = await getRoutingProvider().durationsTo(candidates, { lat: ride.pickupLat, lng: ride.pickupLng });
  } catch (err) {
    logger.warn("ETA ranking failed; using distance only", { err });
    etas = candidates.map((c) => Math.round(c.distanceMeters / 7)); // ≈25 km/h
  }
  const ranked = candidates
    .map((c, i) => ({ ...c, etaSeconds: Number.isFinite(etas[i]) ? etas[i]! : Math.round(c.distanceMeters / 7) }))
    .sort((a, b) => a.etaSeconds - b.etaSeconds || a.distanceMeters - b.distanceMeters);

  let offered = 0;
  for (const c of ranked) {
    if (offered >= slots) break;
    const created = await createOffer(rideId, c, city.offerTimeoutSeconds, city.offerBatchSize);
    if (created) offered++;
  }
  return offered > 0 ? "OFFERED" : "WAITING";
}

async function createOffer(rideId: string, c: Candidate & { etaSeconds: number }, timeoutSeconds: number, batchSize: number): Promise<boolean> {
  try {
    return await withTransaction(async (tx) => {
      const ride = await lockRide(tx, rideId);
      if (ride.status !== "SEARCHING") return false;
      const pending = await tx.rideOffer.count({ where: { rideId, status: "PENDING" } });
      if (pending >= batchSize) return false;
      const sequence = (await tx.rideOffer.count({ where: { rideId } })) + 1;
      const offer = await tx.rideOffer.create({
        data: {
          rideId,
          driverId: c.driverId,
          distanceMeters: c.distanceMeters,
          etaSeconds: c.etaSeconds,
          sequence,
          expiresAt: new Date(Date.now() + timeoutSeconds * 1000),
        },
      });
      await publish(tx, { type: "ride.offer", audience: [c.driverId], rideId, data: { offerId: offer.id, expiresAt: offer.expiresAt.toISOString() } });
      return true;
    });
  } catch (err) {
    // Driver already has a pending offer or was already offered this ride (concurrent dispatch): skip.
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

async function markNoDriver(rideId: string): Promise<boolean> {
  return withTransaction(async (tx) => {
    const ride = await lockRide(tx, rideId);
    if (ride.status !== "SEARCHING") return false;
    const pending = await tx.rideOffer.count({ where: { rideId, status: "PENDING", expiresAt: { gt: new Date() } } });
    if (pending > 0) return false;
    const updated = await applyTransition(tx, ride, "NO_DRIVER", { type: "SYSTEM" }, {}, { reason: "Qidiruv siyosati tugadi" });
    await notifyRide(tx, updated);
    return true;
  });
}

export type AcceptResult = { ok: true; ride: Ride } | { ok: false; code: "OFFER_EXPIRED" | "RIDE_UNAVAILABLE" };

/**
 * Atomically assigns the ride to the accepting driver. Lock order is always ride → offer,
 * matching cancellation paths, so concurrent accepts/cancels serialise without deadlocks.
 * Exactly one of several simultaneous acceptances can succeed.
 */
export async function acceptOffer(driverId: string, offerId: string): Promise<Ride> {
  const offer0 = await db().rideOffer.findUnique({ where: { id: offerId } });
  if (!offer0 || offer0.driverId !== driverId) throw Errors.notFound("Taklif");

  let result: AcceptResult;
  try {
    result = await withTransaction(async (tx): Promise<AcceptResult> => {
      const ride = await lockRide(tx, offer0.rideId);
      const [offer] = await tx.$queryRaw<{ status: string; expires_at: Date }[]>`
        SELECT status::text, expires_at FROM ride_offers WHERE id = ${offerId}::uuid FOR UPDATE`;
      if (!offer || offer.status !== "PENDING") {
        return { ok: false, code: offer?.status === "EXPIRED" ? "OFFER_EXPIRED" : "RIDE_UNAVAILABLE" };
      }
      if (offer.expires_at.getTime() <= Date.now()) {
        await tx.rideOffer.update({ where: { id: offerId }, data: { status: "EXPIRED", respondedAt: new Date() } });
        return { ok: false, code: "OFFER_EXPIRED" };
      }
      if (ride.status !== "SEARCHING" || ride.driverId) {
        await tx.rideOffer.update({ where: { id: offerId }, data: { status: "CANCELLED", respondedAt: new Date() } });
        return { ok: false, code: "RIDE_UNAVAILABLE" };
      }
      const profile = await tx.driverProfile.findUnique({
        where: { userId: driverId },
        include: { vehicles: { where: { isActive: true }, include: { vehicle: true } }, user: true },
      });
      const vehicle = profile?.vehicles[0]?.vehicle;
      if (!profile || profile.status !== "APPROVED" || profile.availability !== "ONLINE" || profile.user.status !== "ACTIVE" || !vehicle || vehicle.status !== "APPROVED") {
        throw Errors.forbidden("Hisobingiz buyurtma qabul qila olmaydi.");
      }
      const assigned = await applyTransition(
        tx,
        ride,
        "ASSIGNED",
        { type: "DRIVER", id: driverId },
        { driverId, vehicleId: vehicle.id, assignedAt: new Date() },
        { metadata: { offerId } },
      );
      await tx.rideOffer.update({ where: { id: offerId }, data: { status: "ACCEPTED", respondedAt: new Date() } });
      const others = await tx.rideOffer.findMany({ where: { rideId: ride.id, status: "PENDING", id: { not: offerId } }, select: { driverId: true } });
      if (others.length) {
        await tx.rideOffer.updateMany({ where: { rideId: ride.id, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
        await publish(tx, { type: "ride.offer.closed", audience: others.map((o) => o.driverId), rideId: ride.id });
      }
      await notifyRide(tx, assigned);
      return { ok: true, ride: assigned };
    });
  } catch (err) {
    if (isUniqueViolation(err, "rides_one_active_per_driver")) {
      throw Errors.conflict("DRIVER_BUSY", "Sizda allaqachon faol buyurtma bor.");
    }
    throw err;
  }
  if (!result.ok) {
    if (result.code === "OFFER_EXPIRED") throw new AppError("OFFER_EXPIRED", 409, "Taklif muddati tugadi.");
    throw new AppError("RIDE_UNAVAILABLE", 409, "Buyurtma bekor qilingan yoki boshqa haydovchiga berildi.");
  }
  return result.ride;
}

export async function rejectOffer(driverId: string, offerId: string) {
  const offer0 = await db().rideOffer.findUnique({ where: { id: offerId } });
  if (!offer0 || offer0.driverId !== driverId) throw Errors.notFound("Taklif");
  const changed = await withTransaction(async (tx) => {
    await lockRide(tx, offer0.rideId);
    const res = await tx.rideOffer.updateMany({ where: { id: offerId, status: "PENDING" }, data: { status: "REJECTED", respondedAt: new Date() } });
    return res.count === 1;
  });
  if (changed) await dispatchRide(offer0.rideId).catch((err) => reportError(err, { where: "dispatch.afterReject" }));
  return changed;
}

/** Expires overdue offers and moves each affected ride on to the next driver. */
export async function expireOffers(): Promise<number> {
  const expired = await db().$queryRaw<{ ride_id: string; driver_id: string }[]>`
    UPDATE ride_offers SET status = 'EXPIRED', responded_at = now()
     WHERE status = 'PENDING' AND expires_at <= now()
    RETURNING ride_id::text, driver_id::text`;
  if (expired.length === 0) return 0;
  await publish(db(), { type: "ride.offer.closed", audience: [...new Set(expired.map((e) => e.driver_id))], data: { reason: "EXPIRED" } });
  for (const rideId of new Set(expired.map((e) => e.ride_id))) {
    await dispatchRide(rideId).catch((err) => reportError(err, { where: "dispatch.afterExpire", rideId }));
  }
  return expired.length;
}

/** Switches drivers offline when their app stopped reporting GPS (closed app, lost network). */
export async function offlineStaleDrivers(): Promise<number> {
  const rows = await db().$queryRaw<{ user_id: string }[]>`
    UPDATE driver_profiles dp SET availability = 'OFFLINE', updated_at = now()
      FROM driver_locations dl
     WHERE dl.driver_id = dp.user_id AND dp.availability = 'ONLINE'
       AND dl.recorded_at < now() - make_interval(secs => ${STALE_DRIVER_OFFLINE_SECONDS})
       AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = dp.user_id AND r.status IN ('ASSIGNED','ARRIVING','ARRIVED','IN_PROGRESS'))
    RETURNING dp.user_id::text`;
  if (rows.length) {
    await publish(db(), { type: "driver.status", audience: [...rows.map((r) => r.user_id), STAFF_AUDIENCE], data: { availability: "OFFLINE", reason: "STALE_GPS" } });
  }
  return rows.length;
}

/** One dispatch cycle; run every few seconds by the worker or the cron endpoint. */
export async function dispatchTick() {
  const expired = await expireOffers();
  const searching = await db().$queryRaw<{ id: string }[]>`
    SELECT r.id::text FROM rides r
     WHERE r.status = 'SEARCHING'
       AND NOT EXISTS (SELECT 1 FROM ride_offers o WHERE o.ride_id = r.id AND o.status = 'PENDING')
     ORDER BY r.search_started_at ASC
     LIMIT 100`;
  const outcomes: Record<string, number> = {};
  for (const { id } of searching) {
    try {
      const o = await dispatchRide(id);
      outcomes[o] = (outcomes[o] ?? 0) + 1;
    } catch (err) {
      reportError(err, { where: "dispatchTick", rideId: id });
    }
  }
  const offline = await offlineStaleDrivers();
  return { expired, searched: searching.length, outcomes, offline };
}
