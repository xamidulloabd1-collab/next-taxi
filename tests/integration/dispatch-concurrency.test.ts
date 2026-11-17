import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/lib/db/prisma";
import { createQuotes } from "@/features/pricing/service";
import { cancelRideByPassenger, createRide } from "@/features/rides/service";
import { acceptOffer, dispatchRide, dispatchTick, expireOffers, findCandidates, rejectOffer } from "@/features/dispatch/service";
import { getPendingOffer, setAvailability } from "@/features/drivers/service";
import { CENTER, DROPOFF, PICKUP, createCity, createDriver, createPassenger, truncateAll } from "../helpers/factories";

beforeEach(truncateAll);
afterAll(disconnectDb);

async function quoteAndBook(passengerId: string) {
  const [q] = await createQuotes(passengerId, { pickup: PICKUP, dropoff: DROPOFF });
  return createRide(passengerId, { quoteId: q!.id });
}

describe("driver eligibility", () => {
  it("only approved, online, fresh, in-radius drivers of the right class are candidates", async () => {
    const city = await createCity({ searchRadiusMeters: 3000 });
    const ok = await createDriver(city.id);
    await createDriver(city.id, { approved: false });
    await createDriver(city.id, { online: false });
    await createDriver(city.id, { locationAgeSeconds: 600 });
    await createDriver(city.id, { location: { lat: CENTER.lat + 0.05, lng: CENTER.lng } }); // ~5.5 km away
    await createDriver(city.id, { vehicleClass: "COMFORT" });
    await createDriver(city.id, { location: null });
    const p = await createPassenger();
    const [q] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    const ride = await createRide(p.id, { quoteId: q!.id });
    // The single eligible driver already holds the offer, so query with a fresh ride shape:
    const offers = await db().rideOffer.findMany({ where: { rideId: ride.id } });
    expect(offers.map((o) => o.driverId)).toEqual([ok.user.id]);
    const others = await findCandidates({ ...ride, id: "00000000-0000-0000-0000-000000000000" }, 3000, 10);
    expect(others).toHaveLength(0); // ok driver now has a pending offer → excluded
  });

  it("unapproved drivers never receive offers and cannot go online", async () => {
    const city = await createCity();
    const { user } = await createDriver(city.id, { approved: false, online: false });
    await expect(setAvailability(user.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await createPassenger();
    await quoteAndBook(p.id);
    expect(await getPendingOffer(user.id)).toBeNull();
  });

  it("drivers over the commission-debt limit are excluded", async () => {
    const city = await createCity({ maxDriverDebt: 1000 });
    const { user } = await createDriver(city.id);
    await db().ledgerEntry.createMany({
      data: [
        { transactionId: "11111111-1111-1111-1111-111111111111", eventType: "COMMISSION_ACCRUED", account: "DRIVER_COMMISSION_RECEIVABLE", direction: "DEBIT", amount: 5000, driverId: user.id },
        { transactionId: "11111111-1111-1111-1111-111111111111", eventType: "COMMISSION_ACCRUED", account: "PLATFORM_COMMISSION_REVENUE", direction: "CREDIT", amount: 5000, driverId: user.id },
      ],
    });
    const p = await createPassenger();
    await quoteAndBook(p.id);
    expect(await getPendingOffer(user.id)).toBeNull();
    await db().driverProfile.update({ where: { userId: user.id }, data: { availability: "OFFLINE" } });
    await expect(setAvailability(user.id, true)).rejects.toMatchObject({ code: "COMMISSION_DEBT_LIMIT" });
  });
});

describe("offer flow", () => {
  it("rejected and expired offers move on to the next-nearest driver", async () => {
    const city = await createCity();
    const near = await createDriver(city.id, { location: { lat: PICKUP.lat + 0.001, lng: PICKUP.lng } });
    const mid = await createDriver(city.id, { location: { lat: PICKUP.lat + 0.006, lng: PICKUP.lng } });
    const far = await createDriver(city.id, { location: { lat: PICKUP.lat + 0.012, lng: PICKUP.lng } });
    const p = await createPassenger();
    const ride = await quoteAndBook(p.id);

    const o1 = await getPendingOffer(near.user.id);
    expect(o1?.rideId).toBe(ride.id);
    await rejectOffer(near.user.id, o1!.id);
    const o2 = await getPendingOffer(mid.user.id);
    expect(o2?.rideId).toBe(ride.id);

    await db().rideOffer.update({ where: { id: o2!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireOffers()).toBe(1);
    expect((await getPendingOffer(far.user.id))?.rideId).toBe(ride.id);
    await expect(acceptOffer(mid.user.id, o2!.id)).rejects.toMatchObject({ code: "OFFER_EXPIRED" });
  });

  it("an expired-but-unprocessed offer cannot be accepted", async () => {
    const city = await createCity();
    const d = await createDriver(city.id);
    const p = await createPassenger();
    await quoteAndBook(p.id);
    const offer = await db().rideOffer.findFirstOrThrow({ where: { driverId: d.user.id } });
    await db().rideOffer.update({ where: { id: offer.id }, data: { expiresAt: new Date(Date.now() - 500) } });
    await expect(acceptOffer(d.user.id, offer.id)).rejects.toMatchObject({ code: "OFFER_EXPIRED" });
  });

  it("stops after the maximum number of offers with NO_DRIVER", async () => {
    const city = await createCity({ maxOffersPerRide: 2 });
    const a = await createDriver(city.id, { location: { lat: PICKUP.lat + 0.001, lng: PICKUP.lng } });
    const b = await createDriver(city.id, { location: { lat: PICKUP.lat + 0.002, lng: PICKUP.lng } });
    await createDriver(city.id, { location: { lat: PICKUP.lat + 0.003, lng: PICKUP.lng } });
    const p = await createPassenger();
    const ride = await quoteAndBook(p.id);
    await rejectOffer(a.user.id, (await getPendingOffer(a.user.id))!.id);
    await rejectOffer(b.user.id, (await getPendingOffer(b.user.id))!.id);
    await dispatchTick();
    expect((await db().ride.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe("NO_DRIVER");
  });
});

describe("concurrency guarantees", () => {
  it("simultaneous acceptance by several offered drivers assigns exactly one", async () => {
    const city = await createCity({ offerBatchSize: 3 });
    const drivers = await Promise.all([0, 1, 2].map((i) => createDriver(city.id, { location: { lat: PICKUP.lat + 0.001 * (i + 1), lng: PICKUP.lng } })));
    const p = await createPassenger();
    const ride = await quoteAndBook(p.id);
    const offers = await db().rideOffer.findMany({ where: { rideId: ride.id, status: "PENDING" } });
    expect(offers).toHaveLength(3);

    const results = await Promise.allSettled(offers.map((o) => acceptOffer(o.driverId, o.id)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) expect((f.reason as { code: string }).code).toBe("RIDE_UNAVAILABLE");

    const final = await db().ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(final.status).toBe("ASSIGNED");
    expect(drivers.map((d) => d.user.id)).toContain(final.driverId);
    const statuses = (await db().rideOffer.findMany({ where: { rideId: ride.id } })).map((o) => o.status).sort();
    expect(statuses).toEqual(["ACCEPTED", "CANCELLED", "CANCELLED"]);
    const assignedEvents = await db().rideStatusEvent.count({ where: { rideId: ride.id, toStatus: "ASSIGNED" } });
    expect(assignedEvents).toBe(1);
  });

  it("double-tapping accept on the same offer assigns once", async () => {
    const city = await createCity();
    const d = await createDriver(city.id);
    const p = await createPassenger();
    const ride = await quoteAndBook(p.id);
    const offer = (await getPendingOffer(d.user.id))!;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => acceptOffer(d.user.id, offer.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().rideStatusEvent.count({ where: { rideId: ride.id, toStatus: "ASSIGNED" } })).toBe(1);
  });

  it("accept racing passenger cancellation ends in exactly one consistent outcome", async () => {
    for (let i = 0; i < 5; i++) {
      await truncateAll();
      const city = await createCity();
      const d = await createDriver(city.id);
      const p = await createPassenger();
      const ride = await quoteAndBook(p.id);
      const offer = (await getPendingOffer(d.user.id))!;
      const [acc, can] = await Promise.allSettled([acceptOffer(d.user.id, offer.id), cancelRideByPassenger(p.id, ride.id)]);
      const final = await db().ride.findUniqueOrThrow({ where: { id: ride.id } });
      expect(final.status).toBe("CANCELLED"); // cancel always succeeds (allowed from SEARCHING and ASSIGNED)
      expect(can.status).toBe("fulfilled");
      if (acc.status === "fulfilled") {
        const events = await db().rideStatusEvent.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: "asc" } });
        expect(events.map((e) => e.toStatus)).toEqual(["REQUESTED", "SEARCHING", "ASSIGNED", "CANCELLED"]);
      } else {
        expect((acc.reason as { code: string }).code).toBe("RIDE_UNAVAILABLE");
      }
    }
  });

  it("concurrent booking requests with the same quote create one ride", async () => {
    await createCity();
    const p = await createPassenger();
    const [q] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createRide(p.id, { quoteId: q!.id })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().ride.count({ where: { passengerId: p.id } })).toBe(1);
  });

  it("concurrent bookings with different quotes still leave one active ride", async () => {
    await createCity();
    const p = await createPassenger();
    const quotes = await Promise.all([0, 1, 2, 3].map(() => createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF })));
    const results = await Promise.allSettled(quotes.map(([q]) => createRide(p.id, { quoteId: q!.id })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected") as PromiseRejectedResult[]) {
      expect((r.reason as { code: string }).code).toBe("ACTIVE_RIDE_EXISTS");
    }
  });

  it("a driver can never hold two active rides (database guarantee)", async () => {
    const city = await createCity({ offerBatchSize: 1 });
    const d = await createDriver(city.id);
    const p1 = await createPassenger();
    const p2 = await createPassenger();
    const r1 = await quoteAndBook(p1.id);
    const r2 = await quoteAndBook(p2.id);
    await acceptOffer(d.user.id, (await getPendingOffer(d.user.id))!.id);
    // Force a second offer to the busy driver, bypassing dispatch filters, then accept it.
    const other = r1.id === (await db().ride.findFirstOrThrow({ where: { driverId: d.user.id } })).id ? r2 : r1;
    const forced = await db().rideOffer.create({ data: { rideId: other.id, driverId: d.user.id, distanceMeters: 100, etaSeconds: 60, sequence: 9, expiresAt: new Date(Date.now() + 60_000) } });
    await expect(acceptOffer(d.user.id, forced.id)).rejects.toMatchObject({ code: "DRIVER_BUSY" });
    expect(await db().ride.count({ where: { driverId: d.user.id } })).toBe(1);
  });

  it("parallel dispatch ticks never create duplicate offers", async () => {
    const city = await createCity();
    await Promise.all([0, 1, 2].map((i) => createDriver(city.id, { location: { lat: PICKUP.lat + 0.002 * (i + 1), lng: PICKUP.lng } })));
    const p = await createPassenger();
    const ride = await quoteAndBook(p.id);
    await Promise.all(Array.from({ length: 6 }, () => dispatchRide(ride.id)));
    expect(await db().rideOffer.count({ where: { rideId: ride.id, status: "PENDING" } })).toBe(1);
  });
});
