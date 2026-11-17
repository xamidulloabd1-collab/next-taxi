import { randomInt } from "node:crypto";
import type { Prisma, Role, VehicleClass } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import type { AuthContext } from "@/lib/auth/session";
import { circlePolygon } from "../../prisma/seed-data";

export const CENTER = { lat: 38.62083, lng: 66.24806 };

/** Removes all rows (keeps schema, PostGIS metadata and migration history). */
export async function truncateAll() {
  const tables = await db().$queryRaw<{ tablename: string }[]>`
    SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('spatial_ref_sys', '_prisma_migrations')`;
  // Immutability triggers block DELETE, but TRUNCATE is a separate privilege used only in tests.
  await db().$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

let phoneSeq = randomInt(0, 5_000_000);
export function uniquePhone() {
  phoneSeq++;
  return `+99893${String(phoneSeq).padStart(7, "0")}`;
}

export async function createCity(opts: Partial<Prisma.CityUncheckedCreateInput> = {}) {
  const city = await db().city.create({
    data: {
      slug: `test-${randomInt(0, 1e9)}`,
      name: "Test shahar",
      region: "Qashqadaryo viloyati",
      status: "ACTIVE",
      centerLat: CENTER.lat,
      centerLng: CENTER.lng,
      operatingHoursStart: "00:00",
      operatingHoursEnd: "00:00",
      searchRadiusMeters: 5000,
      offerTimeoutSeconds: 20,
      offerBatchSize: 1,
      maxOffersPerRide: 8,
      searchTimeoutSeconds: 180,
      maxDriverDebt: 200000,
      ...opts,
    },
  });
  await db().serviceZone.create({
    data: { cityId: city.id, name: "Test zone", boundary: circlePolygon(CENTER.lat, CENTER.lng, 4000) as unknown as Prisma.InputJsonValue },
  });
  await db().tariff.create({
    data: { cityId: city.id, vehicleClass: "ECONOMY", name: "Ekonom", version: 1, baseFare: 5000, perKm: 1500, perMinute: 200, minimumFare: 8000, roundingStep: 500, commissionBps: 1000, quoteTtlSeconds: 300 },
  });
  return city;
}

export async function createPassenger() {
  const user = await db().user.create({ data: { phone: uniquePhone(), fullName: "Test Yo‘lovchi", roles: { create: { role: "PASSENGER" } }, passengerProfile: { create: {} } } });
  return user;
}

export async function createDriver(
  cityId: string,
  opts: { approved?: boolean; online?: boolean; location?: { lat: number; lng: number } | null; vehicleClass?: VehicleClass; locationAgeSeconds?: number } = {},
) {
  const approved = opts.approved ?? true;
  const user = await db().user.create({
    data: {
      phone: uniquePhone(),
      fullName: "Test Haydovchi",
      roles: { create: { role: "DRIVER" } },
      driverProfile: {
        create: {
          status: approved ? "APPROVED" : "PENDING_REVIEW",
          availability: opts.online === false ? "OFFLINE" : "ONLINE",
          cityId,
          licenseNumber: "AA1234567",
          licenseExpiry: new Date("2031-01-01"),
        },
      },
    },
  });
  const vehicle = await db().vehicle.create({
    data: {
      plateNumber: `70T${String(randomInt(0, 1e6)).padStart(6, "0")}`,
      make: "Chevrolet",
      model: "Cobalt",
      color: "Oq",
      year: 2022,
      vehicleClass: opts.vehicleClass ?? "ECONOMY",
      status: approved ? "APPROVED" : "PENDING_REVIEW",
      cityId,
    },
  });
  await db().driverVehicle.create({ data: { driverId: user.id, vehicleId: vehicle.id, isActive: true } });
  const loc = opts.location === undefined ? { lat: CENTER.lat + 0.003, lng: CENTER.lng + 0.002 } : opts.location;
  if (loc) {
    const age = opts.locationAgeSeconds ?? 0;
    await db().$executeRaw`
      INSERT INTO driver_locations (driver_id, lat, lng, recorded_at, updated_at)
      VALUES (${user.id}::uuid, ${loc.lat}, ${loc.lng}, now() - make_interval(secs => ${age}), now())`;
  }
  return { user, vehicle };
}

export async function setDriverLocation(driverId: string, lat: number, lng: number) {
  await db().$executeRaw`
    INSERT INTO driver_locations (driver_id, lat, lng, recorded_at, updated_at) VALUES (${driverId}::uuid, ${lat}, ${lng}, now(), now())
    ON CONFLICT (driver_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, recorded_at = now(), updated_at = now()`;
}

export async function createStaff(role: Role, cityId: string | null = null) {
  const user = await db().user.create({ data: { phone: uniquePhone(), fullName: `Staff ${role}`, roles: { create: { role, cityId } } } });
  const ctx: AuthContext = {
    userId: user.id,
    phone: user.phone,
    fullName: user.fullName,
    roles: [role],
    roleCities: { [role]: cityId },
    app: "admin",
    sessionId: "test",
  };
  return { user, ctx };
}

export const PICKUP = { lat: CENTER.lat + 0.001, lng: CENTER.lng + 0.001, address: "Test olib ketish" };
export const DROPOFF = { lat: CENTER.lat - 0.012, lng: CENTER.lng + 0.01, address: "Test manzil" };
