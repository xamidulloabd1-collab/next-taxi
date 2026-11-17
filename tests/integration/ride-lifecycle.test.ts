import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/lib/db/prisma";
import { createQuotes } from "@/features/pricing/service";
import { calculateFare } from "@/features/pricing/fare";
import {
  cancelRideByPassenger,
  createRide,
  driverArrived,
  driverCancelRide,
  driverCompleteRide,
  driverConfirmCash,
  driverEnRoute,
  driverStartRide,
  getActivePassengerRide,
  getPassengerRide,
  listPassengerRides,
} from "@/features/rides/service";
import { acceptOffer, dispatchRide, dispatchTick } from "@/features/dispatch/service";
import { getPendingOffer, driverEarnings } from "@/features/drivers/service";
import { rateRide } from "@/features/ratings/service";
import { CENTER, DROPOFF, PICKUP, createCity, createDriver, createPassenger, setDriverLocation, truncateAll } from "../helpers/factories";

beforeEach(truncateAll);
afterAll(disconnectDb);

async function bookRide(passengerId: string) {
  const [quote] = await createQuotes(passengerId, { pickup: PICKUP, dropoff: DROPOFF });
  return createRide(passengerId, { quoteId: quote!.id });
}

describe("fare quotes", () => {
  it("are computed on the server from the route and the active tariff", async () => {
    await createCity();
    const p = await createPassenger();
    const [q] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    const tariff = await db().tariff.findUniqueOrThrow({ where: { id: q!.tariffId } });
    expect(q!.totalFare).toBe(calculateFare(tariff, q!.distanceMeters, q!.durationSeconds).totalFare);
    expect(q!.routeProvider).toBe("estimate:estimated");
    expect(q!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reject pickups outside service zones and destinations outside the city", async () => {
    await createCity();
    const p = await createPassenger();
    const far = { lat: CENTER.lat + 0.2, lng: CENTER.lng };
    await expect(createQuotes(p.id, { pickup: far, dropoff: DROPOFF })).rejects.toMatchObject({ code: "PICKUP_OUT_OF_AREA" });
    await expect(createQuotes(p.id, { pickup: PICKUP, dropoff: far })).rejects.toMatchObject({ code: "DROPOFF_OUT_OF_AREA" });
  });

  it("respect operating hours and inactive cities", async () => {
    const city = await createCity({ operatingHoursStart: "03:00", operatingHoursEnd: "03:01" });
    const p = await createPassenger();
    await expect(createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF })).rejects.toMatchObject({ code: "OUTSIDE_OPERATING_HOURS" });
    await db().city.update({ where: { id: city.id }, data: { status: "INACTIVE" } });
    await expect(createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF })).rejects.toMatchObject({ code: "PICKUP_OUT_OF_AREA" });
  });

  it("reject too-short trips", async () => {
    await createCity();
    const p = await createPassenger();
    await expect(createQuotes(p.id, { pickup: PICKUP, dropoff: { lat: PICKUP.lat + 0.0003, lng: PICKUP.lng } })).rejects.toMatchObject({ code: "TRIP_TOO_SHORT" });
  });
});

describe("booking rules", () => {
  it("expired, foreign or reused quotes cannot be booked", async () => {
    await createCity();
    const p = await createPassenger();
    const other = await createPassenger();
    const [q] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    await expect(createRide(other.id, { quoteId: q!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db().fareQuote.update({ where: { id: q!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(createRide(p.id, { quoteId: q!.id })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    const [q2] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    await createRide(p.id, { quoteId: q2!.id });
    await expect(createRide(p.id, { quoteId: q2!.id })).rejects.toMatchObject({ code: "QUOTE_USED" });
  });

  it("a passenger cannot hold two active rides", async () => {
    await createCity();
    const p = await createPassenger();
    await bookRide(p.id);
    await expect(bookRide(p.id)).rejects.toMatchObject({ code: "ACTIVE_RIDE_EXISTS" });
  });
});

describe("full ride lifecycle", () => {
  it("runs REQUESTED → … → SETTLED with persisted history, payment, commission and ratings", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const { user: d } = await createDriver(city.id);

    const ride = await bookRide(p.id);
    expect(ride.status).toBe("SEARCHING");
    const offer = await getPendingOffer(d.id);
    expect(offer?.rideId).toBe(ride.id);
    expect(offer?.fare).toBe(ride.quotedFare);

    await acceptOffer(d.id, offer!.id);
    let view = await getPassengerRide(p.id, ride.id);
    expect(view.status).toBe("ASSIGNED");
    expect(view.driver?.phone).toBeTruthy(); // visible while active
    expect(view.vehicle?.plateNumber).toMatch(/^70T/);

    await driverEnRoute(d.id, ride.id);
    await setDriverLocation(d.id, PICKUP.lat + 0.0005, PICKUP.lng);
    await driverArrived(d.id, ride.id);
    await driverStartRide(d.id, ride.id);
    const completed = await driverCompleteRide(d.id, ride.id);
    expect(completed.finalFare).toBe(ride.quotedFare);
    expect(completed.commissionAmount! + completed.driverEarnings!).toBe(ride.quotedFare);
    const settled = await driverConfirmCash(d.id, ride.id);
    expect(settled.status).toBe("SETTLED");

    const events = await db().rideStatusEvent.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.toStatus)).toEqual(["REQUESTED", "SEARCHING", "ASSIGNED", "ARRIVING", "ARRIVED", "IN_PROGRESS", "COMPLETED", "SETTLED"]);
    const payment = await db().payment.findUniqueOrThrow({ where: { rideId: ride.id } });
    expect(payment).toMatchObject({ method: "CASH", status: "COLLECTED_BY_DRIVER", amount: ride.quotedFare });

    view = await getPassengerRide(p.id, ride.id);
    expect(view.driver?.phone).toBeNull(); // contact hidden after the ride
    expect(view.driver?.location).toBeNull();
    expect((await listPassengerRides(p.id)).items[0]?.id).toBe(ride.id);
    expect(await getActivePassengerRide(p.id)).toBeNull();

    const earnings = await driverEarnings(d.id);
    expect(earnings.today.rides).toBe(1);
    expect(earnings.today.net).toBe(settled.driverEarnings);
    expect(earnings.outstandingCommission).toBe(settled.commissionAmount);

    await rateRide(p.id, "PASSENGER", ride.id, 5, "Zo‘r");
    await expect(rateRide(p.id, "PASSENGER", ride.id, 4)).rejects.toMatchObject({ code: "ALREADY_RATED" });
    const dp = await db().driverProfile.findUniqueOrThrow({ where: { userId: d.id } });
    expect(dp.ratingCount).toBe(1);
  });

  it("rejects out-of-order driver actions and actions by other drivers", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const { user: d } = await createDriver(city.id);
    const { user: other } = await createDriver(city.id, { location: { lat: CENTER.lat + 0.02, lng: CENTER.lng } });
    const ride = await bookRide(p.id);
    const offer = await getPendingOffer(d.id);
    await acceptOffer(d.id, offer!.id);
    await expect(driverStartRide(d.id, ride.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(driverCompleteRide(d.id, ride.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(driverEnRoute(other.id, ride.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getPassengerRide((await createPassenger()).id, ride.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates arrival against the driver's GPS position", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const { user: d } = await createDriver(city.id);
    const ride = await bookRide(p.id);
    await acceptOffer(d.id, (await getPendingOffer(d.id))!.id);
    await setDriverLocation(d.id, PICKUP.lat + 0.02, PICKUP.lng);
    await expect(driverArrived(d.id, ride.id)).rejects.toMatchObject({ code: "TOO_FAR_FROM_PICKUP" });
  });
});

describe("cancellation", () => {
  it("passenger cancellation closes pending offers and frees the driver", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const { user: d } = await createDriver(city.id);
    const ride = await bookRide(p.id);
    const offer = await getPendingOffer(d.id);
    await cancelRideByPassenger(p.id, ride.id, "Rejam o‘zgardi");
    expect((await db().rideOffer.findUniqueOrThrow({ where: { id: offer!.id } })).status).toBe("CANCELLED");
    await expect(acceptOffer(d.id, offer!.id)).rejects.toMatchObject({ code: "RIDE_UNAVAILABLE" });
    expect((await db().ride.findUniqueOrThrow({ where: { id: ride.id } })).cancelledBy).toBe("PASSENGER");
  });

  it("passenger cannot cancel once the trip is in progress", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const { user: d } = await createDriver(city.id);
    const ride = await bookRide(p.id);
    await acceptOffer(d.id, (await getPendingOffer(d.id))!.id);
    await setDriverLocation(d.id, PICKUP.lat, PICKUP.lng);
    await driverArrived(d.id, ride.id);
    await driverStartRide(d.id, ride.id);
    await expect(cancelRideByPassenger(p.id, ride.id)).rejects.toMatchObject({ code: "NOT_CANCELLABLE" });
  });

  it("driver withdrawal re-dispatches to another driver, never back to the same one", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const { user: d1 } = await createDriver(city.id, { location: { lat: PICKUP.lat + 0.001, lng: PICKUP.lng } });
    const { user: d2 } = await createDriver(city.id, { location: { lat: PICKUP.lat + 0.01, lng: PICKUP.lng } });
    const ride = await bookRide(p.id);
    expect((await getPendingOffer(d1.id))?.rideId).toBe(ride.id); // nearest first
    await acceptOffer(d1.id, (await getPendingOffer(d1.id))!.id);
    const after = await driverCancelRide(d1.id, ride.id, "VEHICLE_PROBLEM");
    expect(after.status).toBe("SEARCHING");
    expect(after.driverId).toBeNull();
    expect(await getPendingOffer(d1.id)).toBeNull();
    expect((await getPendingOffer(d2.id))?.rideId).toBe(ride.id);
  });

  it("no-show cancellation requires arrival plus the waiting period", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const { user: d } = await createDriver(city.id);
    const ride = await bookRide(p.id);
    await acceptOffer(d.id, (await getPendingOffer(d.id))!.id);
    await expect(driverCancelRide(d.id, ride.id, "PASSENGER_NO_SHOW")).rejects.toMatchObject({ code: "NOT_ARRIVED" });
    await setDriverLocation(d.id, PICKUP.lat, PICKUP.lng);
    await driverArrived(d.id, ride.id);
    await expect(driverCancelRide(d.id, ride.id, "PASSENGER_NO_SHOW")).rejects.toMatchObject({ code: "WAIT_LONGER" });
    await db().ride.update({ where: { id: ride.id }, data: { arrivedAt: new Date(Date.now() - 4 * 60_000) } });
    const r = await driverCancelRide(d.id, ride.id, "PASSENGER_NO_SHOW");
    expect(r.status).toBe("CANCELLED");
  });
});

describe("no driver available", () => {
  it("keeps searching until the deadline, then ends with NO_DRIVER", async () => {
    await createCity({ searchTimeoutSeconds: 30 });
    const p = await createPassenger();
    const ride = await bookRide(p.id);
    expect(await dispatchRide(ride.id)).toBe("WAITING");
    await db().ride.update({ where: { id: ride.id }, data: { searchStartedAt: new Date(Date.now() - 60_000) } });
    await dispatchTick();
    expect((await db().ride.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe("NO_DRIVER");
    // Passenger can book again afterwards.
    await expect(bookRide(p.id)).resolves.toMatchObject({ status: "SEARCHING" });
  });
});
