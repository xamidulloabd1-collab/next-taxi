import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, disconnectDb } from "@/lib/db/prisma";
import { createQuotes } from "@/features/pricing/service";
import { createRide, driverArrived, driverCompleteRide, driverConfirmCash, driverStartRide } from "@/features/rides/service";
import { acceptOffer } from "@/features/dispatch/service";
import { getPendingOffer, registerVehicle, setAvailability, submitForReview, updateDriverProfile, uploadDriverDocument } from "@/features/drivers/service";
import { driverOutstandingCommission, financeSummary, reconcile, recordSettlement } from "@/features/payments/service";
import { decideDriver, publishTariffVersion, reviewDocument, reviewVehicle, updateCity } from "@/features/admin/service";
import { requirePermission } from "@/lib/permissions";
import { DROPOFF, PICKUP, createCity, createDriver, createPassenger, createStaff, setDriverLocation, truncateAll, uniquePhone } from "../helpers/factories";
import { completeLogin } from "@/features/auth/service";

beforeEach(truncateAll);
afterAll(disconnectDb);

async function completedRide() {
  const city = await createCity();
  const p = await createPassenger();
  const { user: d } = await createDriver(city.id);
  const [q] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
  const ride = await createRide(p.id, { quoteId: q!.id });
  await acceptOffer(d.id, (await getPendingOffer(d.id))!.id);
  await setDriverLocation(d.id, PICKUP.lat, PICKUP.lng);
  await driverArrived(d.id, ride.id);
  await driverStartRide(d.id, ride.id);
  await driverCompleteRide(d.id, ride.id);
  return { city, passenger: p, driver: d, ride };
}

describe("cash payments and commission ledger", () => {
  it("posts a balanced commission accrual exactly once", async () => {
    const { driver, ride } = await completedRide();
    const settled = await driverConfirmCash(driver.id, ride.id);
    await expect(driverConfirmCash(driver.id, ride.id)).rejects.toMatchObject({ code: "PAYMENT_NOT_PENDING" });
    const entries = await db().ledgerEntry.findMany({ where: { rideId: ride.id } });
    expect(entries).toHaveLength(2);
    const debit = entries.filter((e) => e.direction === "DEBIT").reduce((s, e) => s + e.amount, 0);
    const credit = entries.filter((e) => e.direction === "CREDIT").reduce((s, e) => s + e.amount, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(settled.commissionAmount);
    expect(await driverOutstandingCommission(driver.id)).toBe(settled.commissionAmount);
    expect(await reconcile()).toEqual([]);
  });

  it("ledger entries are immutable and transactions must balance", async () => {
    const { driver, ride } = await completedRide();
    await driverConfirmCash(driver.id, ride.id);
    const entry = await db().ledgerEntry.findFirstOrThrow({ where: { rideId: ride.id } });
    await expect(db().ledgerEntry.update({ where: { id: entry.id }, data: { amount: 1 } })).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(db().ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(
      db().ledgerEntry.create({ data: { transactionId: randomUUID(), eventType: "COMMISSION_SETTLED", account: "PLATFORM_CASH", direction: "DEBIT", amount: 100, driverId: driver.id } }),
    ).rejects.toThrow(/LEDGER_UNBALANCED/);
    await expect(db().ledgerEntry.create({ data: { transactionId: randomUUID(), eventType: "COMMISSION_SETTLED", account: "PLATFORM_CASH", direction: "DEBIT", amount: -5 } })).rejects.toThrow();
  });

  it("settlements reduce the driver's debt and cannot exceed it", async () => {
    const { driver, ride } = await completedRide();
    const settled = await driverConfirmCash(driver.id, ride.id);
    const { ctx } = await createStaff("FINANCE_MANAGER");
    const owed = settled.commissionAmount!;
    await expect(recordSettlement({ driverId: driver.id, amount: owed + 1, method: "CASH_AT_OFFICE" }, { userId: ctx.userId })).rejects.toMatchObject({ code: "SETTLEMENT_EXCEEDS_BALANCE" });
    const r = await recordSettlement({ driverId: driver.id, amount: owed, method: "CASH_AT_OFFICE", reference: "KVT-1" }, { userId: ctx.userId });
    expect(r.outstandingAfter).toBe(0);
    expect(await driverOutstandingCommission(driver.id)).toBe(0);
    const day = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 60_000) };
    expect(await financeSummary(day)).toMatchObject({ settledRides: 1, grossFares: settled.finalFare, commissionAccrued: owed, settlementsReceived: owed, outstandingReceivable: 0 });
    expect(await db().auditLog.count({ where: { action: "settlement.record" } })).toBe(1);
    expect(await reconcile()).toEqual([]);
  });

  it("concurrent settlements cannot overdraw the receivable", async () => {
    const { driver, ride } = await completedRide();
    const settled = await driverConfirmCash(driver.id, ride.id);
    const { ctx } = await createStaff("FINANCE_MANAGER");
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => recordSettlement({ driverId: driver.id, amount: settled.commissionAmount!, method: "BANK_TRANSFER" }, { userId: ctx.userId })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await driverOutstandingCommission(driver.id)).toBe(0);
  });
});

describe("driver onboarding and verification", () => {
  const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

  it("requires documents, vehicle approval and compliance approval before going online", async () => {
    const city = await createCity();
    const user = await completeLogin(uniquePhone(), "driver");
    await updateDriverProfile(user.id, { fullName: "Yangi Haydovchi", cityId: city.id, licenseNumber: "AB1234567", licenseExpiry: "2030-05-01" });
    await expect(submitForReview(user.id)).rejects.toMatchObject({ code: "INCOMPLETE_APPLICATION" });
    const vehicle = await registerVehicle(user.id, { plateNumber: "70 A 777 BC", make: "Chevrolet", model: "Cobalt", color: "Oq", year: 2020, seats: 4, vehicleClass: "ECONOMY" });
    expect(vehicle.plateNumber).toBe("70A777BC");
    await expect(uploadDriverDocument(user.id, "DRIVER_LICENSE", new TextEncoder().encode("<html>"))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    const docs = [];
    for (const t of ["DRIVER_LICENSE", "PASSPORT_ID", "VEHICLE_REGISTRATION", "VEHICLE_PHOTO", "TAXI_LICENSE"] as const) docs.push(await uploadDriverDocument(user.id, t, png));
    await submitForReview(user.id);
    await expect(setAvailability(user.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { ctx } = await createStaff("COMPLIANCE_REVIEWER");
    const m = { ctx };
    await expect(decideDriver(m, user.id, "APPROVE")).rejects.toMatchObject({ code: "DOCUMENTS_NOT_APPROVED" });
    for (const d of docs) await reviewDocument(m, d.id, "APPROVED");
    await expect(decideDriver(m, user.id, "APPROVE")).rejects.toMatchObject({ code: "VEHICLE_NOT_APPROVED" });
    await reviewVehicle(m, vehicle.id, "APPROVED");
    await decideDriver(m, user.id, "APPROVE");
    await expect(setAvailability(user.id, true)).resolves.toBe("ONLINE");
    expect(await db().auditLog.count({ where: { actorId: ctx.userId } })).toBe(7);
  });
});

describe("administrative permissions and scoping", () => {
  it("roles are enforced server-side", async () => {
    const { ctx: support } = await createStaff("SUPPORT_OPERATOR");
    const { ctx: finance } = await createStaff("FINANCE_MANAGER");
    expect(() => requirePermission(support, "tariffs.manage")).toThrow();
    expect(() => requirePermission(support, "settlements.manage")).toThrow();
    expect(() => requirePermission(finance, "drivers.verify")).toThrow();
    expect(() => requirePermission(finance, "settlements.manage")).not.toThrow();
  });

  it("city managers can only change their own city; activation requires zone + tariff + centre", async () => {
    const a = await createCity();
    const b = await createCity();
    const { ctx } = await createStaff("CITY_MANAGER", a.id);
    await expect(updateCity({ ctx }, b.id, { searchRadiusMeters: 4000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateCity({ ctx }, a.id, { searchRadiusMeters: 4000 })).resolves.toMatchObject({ searchRadiusMeters: 4000 });
    const bare = await db().city.create({ data: { slug: "bare", name: "Bare", region: "X" } });
    const { ctx: sa } = await createStaff("SUPER_ADMIN");
    await expect(updateCity({ ctx: sa }, bare.id, { status: "ACTIVE" })).rejects.toMatchObject({ code: "CITY_NOT_READY" });
  });

  it("tariffs are versioned: publishing retires the old version and keeps quotes on their version", async () => {
    const city = await createCity();
    const p = await createPassenger();
    const [oldQuote] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    const { ctx } = await createStaff("SUPER_ADMIN");
    const v2 = await publishTariffVersion({ ctx }, { cityId: city.id, vehicleClass: "ECONOMY", name: "Ekonom v2", baseFare: 6000, perKm: 1600, perMinute: 200, minimumFare: 9000, roundingStep: 500, commissionBps: 1000, quoteTtlSeconds: 300 });
    expect(v2.version).toBe(2);
    expect(await db().tariff.count({ where: { cityId: city.id, isActive: true } })).toBe(1);
    const [newQuote] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    expect(newQuote!.tariffVersion).toBe(2);
    expect(newQuote!.totalFare).toBeGreaterThan(oldQuote!.totalFare);
    // A quote taken before the change still books at its locked price.
    const ride = await createRide(p.id, { quoteId: oldQuote!.id });
    expect(ride.quotedFare).toBe(oldQuote!.totalFare);
  });

  it("invalid zone polygons are rejected by PostGIS validation", async () => {
    const city = await createCity();
    const { ctx } = await createStaff("SUPER_ADMIN");
    const { saveZone } = await import("@/features/admin/service");
    const bowtie = { type: "Polygon", coordinates: [[[66.2, 38.6], [66.3, 38.7], [66.3, 38.6], [66.2, 38.7], [66.2, 38.6]]] };
    await expect(saveZone({ ctx }, { cityId: city.id, name: "Bad", boundary: bowtie, isActive: true })).rejects.toMatchObject({ code: "INVALID_POLYGON" });
  });
});
