import type { Prisma, Ride, RideStatus } from "@prisma/client";
import { db, withTransaction, isUniqueViolation } from "@/lib/db/prisma";
import { AppError, Errors } from "@/lib/errors";
import { reportError } from "@/lib/monitoring";
import { haversineMeters } from "@/lib/maps/geo";
import { publish } from "@/lib/realtime/events";
import { assertCityOperating } from "@/features/zones/service";
import { applyTransition, generateRideCode, lockRide, notifyRide, type Actor } from "@/features/rides/core";
import { DRIVER_ACTIVE_STATUSES, LIVE_TRACKING_STATUSES, PASSENGER_ACTIVE_STATUSES, RIDE_STATUS_LABELS } from "@/features/rides/state-machine";
import { dispatchRide } from "@/features/dispatch/service";
import { createPendingPayment, postCommissionAccrual, splitForRide } from "@/features/payments/service";
import { getSetting } from "@/features/settings/service";
import { maskUzPhone } from "@/lib/phone";

// ───────────────────────────── Passenger ─────────────────────────────

export interface CreateRideInput {
  quoteId: string;
  note?: string | null;
}

/** Books a ride from a valid, unexpired, unused quote owned by the passenger, then starts dispatch. */
export async function createRide(passengerId: string, input: CreateRideInput): Promise<Ride> {
  let ride: Ride;
  try {
    ride = await withTransaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM fare_quotes WHERE id = ${input.quoteId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw Errors.notFound("Narx hisob-kitobi");
      const quote = await tx.fareQuote.findUniqueOrThrow({ where: { id: input.quoteId }, include: { city: true } });
      if (quote.passengerId !== passengerId) throw Errors.notFound("Narx hisob-kitobi");
      if (quote.usedAt) throw Errors.conflict("QUOTE_USED", "Bu narx bilan buyurtma allaqachon berilgan.");
      if (quote.expiresAt <= new Date()) throw Errors.conflict("QUOTE_EXPIRED", "Narx muddati tugadi. Narxni qayta hisoblang.");
      assertCityOperating(quote.city);

      const active = await tx.ride.findFirst({ where: { passengerId, status: { in: PASSENGER_ACTIVE_STATUSES } }, select: { id: true } });
      if (active) throw Errors.conflict("ACTIVE_RIDE_EXISTS", "Sizda faol buyurtma mavjud.");

      const created = await tx.ride.create({
        data: {
          code: generateRideCode(),
          passengerId,
          cityId: quote.cityId,
          zoneId: quote.zoneId,
          quoteId: quote.id,
          vehicleClass: quote.vehicleClass,
          status: "REQUESTED",
          pickupLat: quote.pickupLat,
          pickupLng: quote.pickupLng,
          pickupAddress: quote.pickupAddress,
          dropoffLat: quote.dropoffLat,
          dropoffLng: quote.dropoffLng,
          dropoffAddress: quote.dropoffAddress,
          distanceMeters: quote.distanceMeters,
          durationSeconds: quote.durationSeconds,
          quotedFare: quote.totalFare,
          commissionBps: quote.commissionBps,
          paymentMethod: "CASH",
          passengerNote: input.note?.slice(0, 300) ?? null,
        },
      });
      await tx.rideStatusEvent.create({ data: { rideId: created.id, fromStatus: null, toStatus: "REQUESTED", actorType: "PASSENGER", actorId: passengerId } });
      await tx.fareQuote.update({ where: { id: quote.id }, data: { usedAt: new Date() } });
      const searching = await applyTransition(tx, created, "SEARCHING", { type: "SYSTEM" }, { searchStartedAt: new Date() });
      await notifyRide(tx, searching);
      return searching;
    });
  } catch (err) {
    if (isUniqueViolation(err, "rides_one_active_per_passenger")) throw Errors.conflict("ACTIVE_RIDE_EXISTS", "Sizda faol buyurtma mavjud.");
    if (isUniqueViolation(err, "quote_id")) throw Errors.conflict("QUOTE_USED", "Bu narx bilan buyurtma allaqachon berilgan.");
    throw err;
  }
  await dispatchRide(ride.id).catch((err) => reportError(err, { where: "dispatch.afterCreate", rideId: ride.id }));
  return ride;
}

const PASSENGER_CANCELLABLE: RideStatus[] = ["REQUESTED", "SEARCHING", "ASSIGNED", "ARRIVING", "ARRIVED"];

export async function cancelRideByPassenger(passengerId: string, rideId: string, reason?: string | null): Promise<Ride> {
  return withTransaction(async (tx) => {
    const ride = await lockRide(tx, rideId);
    if (ride.passengerId !== passengerId) throw Errors.notFound("Buyurtma");
    if (!PASSENGER_CANCELLABLE.includes(ride.status)) throw Errors.conflict("NOT_CANCELLABLE", "Bu bosqichda buyurtmani bekor qilib bo‘lmaydi.");
    const offerDrivers = await closePendingOffers(tx, ride.id);
    const updated = await applyTransition(
      tx,
      ride,
      "CANCELLED",
      { type: "PASSENGER", id: passengerId },
      { cancelledAt: new Date(), cancelledBy: "PASSENGER", cancelReason: reason?.slice(0, 200) ?? "Yo‘lovchi bekor qildi" },
      { reason: reason ?? null },
    );
    await notifyRide(tx, { ...updated, driverId: ride.driverId }, offerDrivers);
    return updated;
  });
}

async function closePendingOffers(tx: Prisma.TransactionClient, rideId: string): Promise<string[]> {
  const pending = await tx.rideOffer.findMany({ where: { rideId, status: "PENDING" }, select: { driverId: true } });
  if (pending.length) {
    await tx.rideOffer.updateMany({ where: { rideId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
    await publish(tx, { type: "ride.offer.closed", audience: pending.map((p) => p.driverId), rideId });
  }
  return pending.map((p) => p.driverId);
}

// ───────────────────────────── Driver ─────────────────────────────

async function lockDriverRide(tx: Prisma.TransactionClient, driverId: string, rideId: string) {
  const ride = await lockRide(tx, rideId);
  if (ride.driverId !== driverId) throw Errors.notFound("Buyurtma");
  return ride;
}

export async function driverEnRoute(driverId: string, rideId: string) {
  return withTransaction(async (tx) => {
    const ride = await lockDriverRide(tx, driverId, rideId);
    const updated = await applyTransition(tx, ride, "ARRIVING", { type: "DRIVER", id: driverId });
    await notifyRide(tx, updated);
    return updated;
  });
}

/** Marks arrival. Validated server-side against the driver's last GPS fix when it is fresh. */
export async function driverArrived(driverId: string, rideId: string) {
  const radius = await getSetting<number>("arrival_radius_meters", 400);
  return withTransaction(async (tx) => {
    const ride = await lockDriverRide(tx, driverId, rideId);
    const loc = await tx.driverLocation.findUnique({ where: { driverId } });
    if (loc && Date.now() - loc.recordedAt.getTime() < 120_000) {
      const d = haversineMeters({ lat: loc.lat, lng: loc.lng }, { lat: ride.pickupLat, lng: ride.pickupLng });
      if (d > radius) {
        throw new AppError("TOO_FAR_FROM_PICKUP", 409, `Siz olib ketish nuqtasidan ${Math.round(d)} m uzoqdasiz.`, { distanceMeters: Math.round(d) });
      }
    }
    const updated = await applyTransition(tx, ride, "ARRIVED", { type: "DRIVER", id: driverId }, { arrivedAt: new Date() });
    await notifyRide(tx, updated);
    return updated;
  });
}

export async function driverStartRide(driverId: string, rideId: string) {
  return withTransaction(async (tx) => {
    const ride = await lockDriverRide(tx, driverId, rideId);
    const updated = await applyTransition(tx, ride, "IN_PROGRESS", { type: "DRIVER", id: driverId }, { startedAt: new Date() });
    await notifyRide(tx, updated);
    return updated;
  });
}

async function completeLocked(tx: Prisma.TransactionClient, ride: Ride, actor: Actor) {
  const split = splitForRide(ride);
  const updated = await applyTransition(tx, ride, "COMPLETED", actor, {
    completedAt: new Date(),
    finalFare: split.fare,
    commissionAmount: split.commission,
    driverEarnings: split.driverEarnings,
  });
  await createPendingPayment(tx, updated);
  await notifyRide(tx, updated);
  return updated;
}

export async function driverCompleteRide(driverId: string, rideId: string) {
  return withTransaction(async (tx) => completeLocked(tx, await lockDriverRide(tx, driverId, rideId), { type: "DRIVER", id: driverId }));
}

async function settleLocked(tx: Prisma.TransactionClient, ride: Ride, actor: Actor) {
  const payment = await tx.payment.findUnique({ where: { rideId: ride.id } });
  if (!payment || payment.status !== "PENDING") throw Errors.conflict("PAYMENT_NOT_PENDING", "To‘lov allaqachon qayd etilgan.");
  const updated = await applyTransition(tx, ride, "SETTLED", actor, { settledAt: new Date() });
  await tx.payment.update({
    where: { id: payment.id },
    data: { status: "COLLECTED_BY_DRIVER", collectedAt: new Date(), confirmedById: actor.id ?? null },
  });
  await postCommissionAccrual(tx, updated, actor.id ?? null);
  await notifyRide(tx, updated);
  return updated;
}

/** Driver confirms the passenger paid the fare in cash; posts the commission receivable. */
export async function driverConfirmCash(driverId: string, rideId: string) {
  return withTransaction(async (tx) => settleLocked(tx, await lockDriverRide(tx, driverId, rideId), { type: "DRIVER", id: driverId }));
}

export const DRIVER_CANCEL_REASONS = {
  PASSENGER_NO_SHOW: "Yo‘lovchi chiqmadi",
  VEHICLE_PROBLEM: "Mashinada nosozlik",
  CANNOT_REACH: "Manzilga yetib bo‘lmaydi",
  OTHER: "Boshqa sabab",
} as const;
export type DriverCancelReason = keyof typeof DRIVER_CANCEL_REASONS;
export const NO_SHOW_WAIT_SECONDS = 180;

/**
 * Driver withdraws. A no-show (after waiting at pickup) cancels the ride; any other reason
 * returns the ride to SEARCHING so another driver is found for the passenger.
 */
export async function driverCancelRide(driverId: string, rideId: string, reason: DriverCancelReason) {
  const result = await withTransaction(async (tx) => {
    const ride = await lockDriverRide(tx, driverId, rideId);
    const actor: Actor = { type: "DRIVER", id: driverId };
    if (reason === "PASSENGER_NO_SHOW") {
      if (ride.status !== "ARRIVED" || !ride.arrivedAt) throw Errors.conflict("NOT_ARRIVED", "Avval manzilga yetib kelganingizni belgilang.");
      const waited = (Date.now() - ride.arrivedAt.getTime()) / 1000;
      if (waited < NO_SHOW_WAIT_SECONDS) {
        throw new AppError("WAIT_LONGER", 409, `Yo‘lovchini yana ${Math.ceil(NO_SHOW_WAIT_SECONDS - waited)} soniya kuting.`);
      }
      const updated = await applyTransition(tx, ride, "CANCELLED", actor, { cancelledAt: new Date(), cancelledBy: "DRIVER", cancelReason: DRIVER_CANCEL_REASONS[reason] }, { reason });
      await notifyRide(tx, { ...updated, driverId });
      return { ride: updated, redispatch: false };
    }
    if (!DRIVER_ACTIVE_STATUSES.includes(ride.status) || ride.status === "IN_PROGRESS") {
      throw Errors.conflict("NOT_CANCELLABLE", "Safar boshlangandan keyin bekor qilib bo‘lmaydi.");
    }
    const updated = await applyTransition(
      tx,
      ride,
      "SEARCHING",
      actor,
      { driverId: null, vehicleId: null, assignedAt: null, arrivedAt: null, searchStartedAt: new Date() },
      { reason, metadata: { previousDriverId: driverId } },
    );
    await notifyRide(tx, updated, [driverId]);
    return { ride: updated, redispatch: true };
  });
  if (result.redispatch) await dispatchRide(rideId).catch((err) => reportError(err, { where: "dispatch.afterDriverCancel" }));
  return result.ride;
}

// ───────────────────────────── Admin ─────────────────────────────

export async function adminCancelRide(staffId: string, rideId: string, reason: string) {
  return withTransaction(async (tx) => {
    const ride = await lockRide(tx, rideId);
    const offerDrivers = await closePendingOffers(tx, ride.id);
    const updated = await applyTransition(tx, ride, "CANCELLED", { type: "ADMIN", id: staffId }, { cancelledAt: new Date(), cancelledBy: "ADMIN", cancelReason: reason.slice(0, 200) }, { reason });
    await notifyRide(tx, { ...updated, driverId: ride.driverId }, offerDrivers);
    return { before: ride, after: updated };
  });
}

export async function adminCompleteRide(staffId: string, rideId: string) {
  return withTransaction(async (tx) => completeLocked(tx, await lockRide(tx, rideId), { type: "ADMIN", id: staffId }));
}

export async function adminConfirmCash(staffId: string, rideId: string) {
  return withTransaction(async (tx) => settleLocked(tx, await lockRide(tx, rideId), { type: "ADMIN", id: staffId }));
}

// ───────────────────────────── Read models ─────────────────────────────

const rideInclude = {
  driver: { include: { user: { select: { fullName: true, phone: true } }, location: true } },
  vehicle: true,
  passenger: { select: { fullName: true, phone: true, passengerProfile: true } },
  payment: true,
  ratings: true,
  quote: { select: { routeGeometry: true, routeProvider: true } },
  city: { select: { name: true, timezone: true } },
} satisfies Prisma.RideInclude;

export type RideWithRelations = Prisma.RideGetPayload<{ include: typeof rideInclude }>;

export async function loadRide(rideId: string) {
  return db().ride.findUnique({ where: { id: rideId }, include: rideInclude });
}

function avg(sum: number, count: number) {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

function baseDto(r: RideWithRelations) {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    statusLabel: RIDE_STATUS_LABELS[r.status],
    cityName: r.city.name,
    vehicleClass: r.vehicleClass,
    pickup: { lat: r.pickupLat, lng: r.pickupLng, address: r.pickupAddress },
    dropoff: { lat: r.dropoffLat, lng: r.dropoffLng, address: r.dropoffAddress },
    distanceMeters: r.distanceMeters,
    durationSeconds: r.durationSeconds,
    routeGeometry: r.quote.routeGeometry,
    routeEstimated: r.quote.routeProvider.endsWith(":estimated"),
    quotedFare: r.quotedFare,
    finalFare: r.finalFare,
    paymentMethod: r.paymentMethod,
    paymentStatus: r.payment?.status ?? null,
    note: r.passengerNote,
    cancelledBy: r.cancelledBy,
    cancelReason: r.cancelReason,
    timestamps: {
      requestedAt: r.requestedAt,
      assignedAt: r.assignedAt,
      arrivedAt: r.arrivedAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      settledAt: r.settledAt,
      cancelledAt: r.cancelledAt,
    },
  };
}

/** Passenger view: driver contact and live location only while the ride is active. */
export function passengerRideDto(r: RideWithRelations) {
  const live = LIVE_TRACKING_STATUSES.includes(r.status);
  const myRating = r.ratings.find((x) => x.raterId === r.passengerId);
  return {
    ...baseDto(r),
    driver: r.driver
      ? {
          name: r.driver.user.fullName ?? "Haydovchi",
          rating: avg(r.driver.ratingSum, r.driver.ratingCount),
          phone: live ? r.driver.user.phone : null,
          location:
            live && r.driver.location
              ? { lat: r.driver.location.lat, lng: r.driver.location.lng, heading: r.driver.location.heading, recordedAt: r.driver.location.recordedAt }
              : null,
        }
      : null,
    vehicle: r.vehicle ? { make: r.vehicle.make, model: r.vehicle.model, color: r.vehicle.color, plateNumber: r.vehicle.plateNumber } : null,
    myRating: myRating ? { score: myRating.score, comment: myRating.comment } : null,
  };
}

/** Driver view: passenger first name; phone only while the ride is active. */
export function driverRideDto(r: RideWithRelations) {
  const live = LIVE_TRACKING_STATUSES.includes(r.status);
  const myRating = r.ratings.find((x) => x.raterId === r.driverId);
  return {
    ...baseDto(r),
    passenger: {
      name: r.passenger.fullName?.split(" ")[0] ?? "Yo‘lovchi",
      phone: live ? r.passenger.phone : null,
      rating: r.passenger.passengerProfile ? avg(r.passenger.passengerProfile.ratingSum, r.passenger.passengerProfile.ratingCount) : null,
    },
    commissionAmount: r.commissionAmount,
    driverEarnings: r.driverEarnings,
    myRating: myRating ? { score: myRating.score } : null,
  };
}

/** Staff view: phone numbers masked; full numbers are available in the user detail page only. */
export function adminRideDto(r: RideWithRelations) {
  return {
    ...baseDto(r),
    passenger: { id: r.passengerId, name: r.passenger.fullName, phoneMasked: maskUzPhone(r.passenger.phone) },
    driver: r.driver ? { id: r.driverId, name: r.driver.user.fullName, phoneMasked: maskUzPhone(r.driver.user.phone), location: r.driver.location } : null,
    vehicle: r.vehicle,
    commissionBps: r.commissionBps,
    commissionAmount: r.commissionAmount,
    driverEarnings: r.driverEarnings,
    payment: r.payment,
  };
}

export async function getPassengerRide(passengerId: string, rideId: string) {
  const r = await loadRide(rideId);
  if (!r || r.passengerId !== passengerId) throw Errors.notFound("Buyurtma");
  return passengerRideDto(r);
}

export async function getDriverRide(driverId: string, rideId: string) {
  const r = await loadRide(rideId);
  if (!r || r.driverId !== driverId) throw Errors.notFound("Buyurtma");
  return driverRideDto(r);
}

export async function getActivePassengerRide(passengerId: string) {
  // Includes COMPLETED (awaiting cash confirmation) so the passenger sees the summary after refresh.
  const r = await db().ride.findFirst({
    where: { passengerId, status: { in: [...PASSENGER_ACTIVE_STATUSES, "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    include: rideInclude,
  });
  return r ? passengerRideDto(r) : null;
}

export async function getActiveDriverRide(driverId: string) {
  const r = await db().ride.findFirst({
    where: { driverId, status: { in: [...DRIVER_ACTIVE_STATUSES, "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    include: rideInclude,
  });
  return r ? driverRideDto(r) : null;
}

export async function listPassengerRides(passengerId: string, take = 30, cursor?: string) {
  const rows = await db().ride.findMany({
    where: { passengerId },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: rideInclude,
  });
  return { items: rows.slice(0, take).map(passengerRideDto), nextCursor: rows.length > take ? rows[take - 1]!.id : null };
}

export async function listDriverRides(driverId: string, take = 30, cursor?: string) {
  const rows = await db().ride.findMany({
    where: { driverId },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: rideInclude,
  });
  return { items: rows.slice(0, take).map(driverRideDto), nextCursor: rows.length > take ? rows[take - 1]!.id : null };
}

export async function rideTimeline(rideId: string) {
  return db().rideStatusEvent.findMany({ where: { rideId }, orderBy: { createdAt: "asc" } });
}
