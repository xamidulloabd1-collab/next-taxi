import { createHash, randomUUID } from "node:crypto";
import type { DocumentType, VehicleClass } from "@prisma/client";
import { db, withTransaction, isUniqueViolation } from "@/lib/db/prisma";
import { AppError, Errors } from "@/lib/errors";
import { enforceRateLimit, hitRateLimit } from "@/lib/rate-limit";
import { getStorage, sniffFileType } from "@/lib/storage";
import { publish, STAFF_AUDIENCE } from "@/lib/realtime/events";
import { startOfLocalDay } from "@/lib/time";
import { driverOutstandingCommission } from "@/features/payments/service";
import { DRIVER_ACTIVE_STATUSES, LIVE_TRACKING_STATUSES } from "@/features/rides/state-machine";
import { getSetting } from "@/features/settings/service";

export const REQUIRED_DOCUMENTS: DocumentType[] = ["DRIVER_LICENSE", "PASSPORT_ID", "VEHICLE_REGISTRATION", "VEHICLE_PHOTO", "TAXI_LICENSE"];
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  DRIVER_LICENSE: "Haydovchilik guvohnomasi",
  PASSPORT_ID: "Pasport / ID karta",
  VEHICLE_REGISTRATION: "Texpasport",
  INSURANCE: "Sug‘urta polisi (OSAGO)",
  VEHICLE_PHOTO: "Avtomobil surati",
  SELFIE: "Yuz surati (selfi)",
  TAXI_LICENSE: "Taksi faoliyati litsenziyasi",
  SELF_EMPLOYED_CERT: "O‘zini o‘zi band qilgan shaxs guvohnomasi",
};
export const MAX_DOCUMENT_BYTES = 6 * 1024 * 1024;

export async function getDriverOverview(driverId: string) {
  const profile = await db().driverProfile.findUnique({
    where: { userId: driverId },
    include: {
      user: { select: { fullName: true, phone: true, status: true } },
      city: { select: { id: true, name: true, status: true, centerLat: true, centerLng: true, defaultZoom: true } },
      documents: { orderBy: { createdAt: "desc" } },
      vehicles: { include: { vehicle: true }, orderBy: { createdAt: "desc" } },
      location: true,
    },
  });
  if (!profile) throw Errors.notFound("Haydovchi profili");
  const latestDocs = new Map<DocumentType, (typeof profile.documents)[number]>();
  for (const d of profile.documents) if (!latestDocs.has(d.type)) latestDocs.set(d.type, d);
  const activeVehicle = profile.vehicles.find((v) => v.isActive)?.vehicle ?? null;
  const missingDocuments = REQUIRED_DOCUMENTS.filter((t) => !latestDocs.has(t) || latestDocs.get(t)!.status === "REJECTED");
  return {
    userId: profile.userId,
    fullName: profile.user.fullName,
    phone: profile.user.phone,
    status: profile.status,
    availability: profile.availability,
    rejectionReason: profile.rejectionReason,
    suspendedReason: profile.suspendedReason,
    city: profile.city,
    licenseNumber: profile.licenseNumber,
    licenseExpiry: profile.licenseExpiry,
    rating: profile.ratingCount ? Math.round((profile.ratingSum / profile.ratingCount) * 10) / 10 : null,
    documents: [...latestDocs.values()].map((d) => ({
      id: d.id,
      type: d.type,
      label: DOCUMENT_LABELS[d.type],
      status: d.status,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt,
    })),
    missingDocuments: missingDocuments.map((t) => ({ type: t, label: DOCUMENT_LABELS[t] })),
    vehicle: activeVehicle,
    outstandingCommission: await driverOutstandingCommission(driverId),
  };
}

export interface DriverProfileInput {
  fullName: string;
  cityId: string;
  licenseNumber: string;
  licenseExpiry: string; // YYYY-MM-DD
}

export async function updateDriverProfile(driverId: string, input: DriverProfileInput) {
  const city = await db().city.findUnique({ where: { id: input.cityId } });
  if (!city) throw Errors.notFound("Shahar");
  const expiry = new Date(`${input.licenseExpiry}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
    throw Errors.badRequest("LICENSE_EXPIRED", "Guvohnoma muddati o‘tgan yoki sana noto‘g‘ri.");
  }
  const profile = await db().driverProfile.findUniqueOrThrow({ where: { userId: driverId } });
  if (profile.status === "APPROVED" && profile.cityId !== input.cityId) {
    throw Errors.conflict("CITY_LOCKED", "Tasdiqlangan haydovchi shaharni o‘zi o‘zgartira olmaydi. Qo‘llab-quvvatlashga murojaat qiling.");
  }
  await db().$transaction([
    db().user.update({ where: { id: driverId }, data: { fullName: input.fullName.trim() } }),
    db().driverProfile.update({
      where: { userId: driverId },
      data: { cityId: input.cityId, licenseNumber: input.licenseNumber.trim().toUpperCase(), licenseExpiry: expiry },
    }),
  ]);
  return getDriverOverview(driverId);
}

export function normalizePlate(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface VehicleInput {
  plateNumber: string;
  make: string;
  model: string;
  color: string;
  year: number;
  seats: number;
  vehicleClass: VehicleClass;
}

/** Registers (or replaces) the driver's vehicle. New vehicles require compliance review. */
export async function registerVehicle(driverId: string, input: VehicleInput) {
  const plate = normalizePlate(input.plateNumber);
  // Uzbek plates: 2-digit region code + letters/digits, e.g. 70A123BC or 70123ABC.
  if (!/^\d{2}[A-Z0-9]{5,7}$/.test(plate)) throw Errors.badRequest("INVALID_PLATE", "Davlat raqami formati noto‘g‘ri (masalan: 70 A 123 BC).");
  const profile = await db().driverProfile.findUniqueOrThrow({ where: { userId: driverId } });
  if (profile.availability === "ONLINE") throw Errors.conflict("GO_OFFLINE_FIRST", "Avtomobilni o‘zgartirishdan oldin oflayn bo‘ling.");
  try {
    return await withTransaction(async (tx) => {
      const existing = await tx.vehicle.findUnique({ where: { plateNumber: plate }, include: { drivers: true } });
      if (existing && existing.drivers.some((d) => d.driverId !== driverId && d.isActive)) {
        throw Errors.conflict("PLATE_IN_USE", "Bu raqamli avtomobil boshqa haydovchiga biriktirilgan.");
      }
      await tx.driverVehicle.updateMany({ where: { driverId, isActive: true }, data: { isActive: false } });
      const vehicle = existing
        ? await tx.vehicle.update({
            where: { id: existing.id },
            data: { make: input.make, model: input.model, color: input.color, year: input.year, seats: input.seats, vehicleClass: input.vehicleClass, status: "PENDING_REVIEW", cityId: profile.cityId },
          })
        : await tx.vehicle.create({
            data: { plateNumber: plate, make: input.make, model: input.model, color: input.color, year: input.year, seats: input.seats, vehicleClass: input.vehicleClass, cityId: profile.cityId },
          });
      await tx.driverVehicle.upsert({
        where: { driverId_vehicleId: { driverId, vehicleId: vehicle.id } },
        create: { driverId, vehicleId: vehicle.id, isActive: true },
        update: { isActive: true },
      });
      return vehicle;
    });
  } catch (err) {
    if (isUniqueViolation(err, "plate_number")) throw Errors.conflict("PLATE_IN_USE", "Bu raqam allaqachon ro‘yxatdan o‘tgan.");
    throw err;
  }
}

/** Stores a document privately after validating size and real file type (magic bytes). */
export async function uploadDriverDocument(driverId: string, type: DocumentType, bytes: Uint8Array) {
  await enforceRateLimit(`doc-upload:${driverId}`, 30, 3600);
  if (bytes.byteLength === 0) throw Errors.badRequest("EMPTY_FILE", "Fayl bo‘sh.");
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw Errors.badRequest("FILE_TOO_LARGE", "Fayl hajmi 6 MB dan oshmasligi kerak.");
  const kind = sniffFileType(bytes);
  if (!kind) throw Errors.badRequest("UNSUPPORTED_FILE", "Faqat JPG, PNG, WEBP yoki PDF fayllar qabul qilinadi.");
  const key = `drivers/${driverId}/${type.toLowerCase().replace(/_/g, "-")}-${randomUUID()}.${kind.ext}`;
  await getStorage().put(key, bytes, kind.mime);
  try {
    return await db().driverDocument.create({
      data: { driverId, type, storageKey: key, mimeType: kind.mime, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") },
    });
  } catch (err) {
    await getStorage().delete(key);
    throw err;
  }
}

/** Moves the application to compliance review once profile, vehicle and required documents exist. */
export async function submitForReview(driverId: string) {
  const o = await getDriverOverview(driverId);
  if (o.status !== "PENDING_DOCUMENTS" && o.status !== "REJECTED") throw Errors.conflict("ALREADY_SUBMITTED", "Ariza allaqachon yuborilgan.");
  const problems: string[] = [];
  if (!o.fullName) problems.push("F.I.Sh.");
  if (!o.city) problems.push("Shahar");
  if (!o.licenseNumber) problems.push("Guvohnoma raqami");
  if (!o.vehicle) problems.push("Avtomobil");
  for (const m of o.missingDocuments) problems.push(m.label);
  if (problems.length) throw Errors.badRequest("INCOMPLETE_APPLICATION", `To‘ldirilmagan: ${problems.join(", ")}`, { missing: problems });
  await db().driverProfile.update({ where: { userId: driverId }, data: { status: "PENDING_REVIEW", rejectionReason: null } });
  await publish(db(), { type: "driver.status", audience: [STAFF_AUDIENCE], data: { driverId, status: "PENDING_REVIEW" } });
  return getDriverOverview(driverId);
}

/** Going online is gated on approval, an approved vehicle, an active city and commission debt. */
export async function setAvailability(driverId: string, online: boolean) {
  const profile = await db().driverProfile.findUniqueOrThrow({
    where: { userId: driverId },
    include: { user: true, city: true, vehicles: { where: { isActive: true }, include: { vehicle: true } } },
  });
  if (!online) {
    const active = await db().ride.findFirst({ where: { driverId, status: { in: DRIVER_ACTIVE_STATUSES } }, select: { id: true } });
    if (active) throw Errors.conflict("ACTIVE_RIDE", "Faol buyurtmani yakunlamasdan oflayn bo‘lib bo‘lmaydi.");
    await db().driverProfile.update({ where: { userId: driverId }, data: { availability: "OFFLINE" } });
    await db().rideOffer.updateMany({ where: { driverId, status: "PENDING" }, data: { status: "REJECTED", respondedAt: new Date() } });
    await publish(db(), { type: "driver.status", audience: [driverId, STAFF_AUDIENCE], data: { availability: "OFFLINE" } });
    return "OFFLINE" as const;
  }
  if (profile.user.status !== "ACTIVE") throw Errors.forbidden("Hisobingiz bloklangan.");
  if (profile.status === "SUSPENDED") throw Errors.forbidden(`Hisobingiz to‘xtatilgan: ${profile.suspendedReason ?? "sabab ko‘rsatilmagan"}`);
  if (profile.status !== "APPROVED") throw Errors.forbidden("Arizangiz hali tasdiqlanmagan.");
  const vehicle = profile.vehicles[0]?.vehicle;
  if (!vehicle || vehicle.status !== "APPROVED") throw Errors.forbidden("Avtomobilingiz tasdiqlanmagan.");
  if (!profile.city || profile.city.status !== "ACTIVE") throw Errors.forbidden("Shahringizda xizmat faol emas.");
  if (profile.licenseExpiry && profile.licenseExpiry.getTime() < Date.now()) throw Errors.forbidden("Haydovchilik guvohnomangiz muddati o‘tgan.");
  const debt = await driverOutstandingCommission(driverId);
  if (debt > profile.city.maxDriverDebt) {
    throw new AppError("COMMISSION_DEBT_LIMIT", 403, `Komissiya qarzi (${debt.toLocaleString("ru-RU")} so‘m) limitdan oshgan. Iltimos, to‘lovni amalga oshiring.`, { debt });
  }
  await db().driverProfile.update({ where: { userId: driverId }, data: { availability: "ONLINE", lastOnlineAt: new Date() } });
  await publish(db(), { type: "driver.status", audience: [driverId, STAFF_AUDIENCE], data: { availability: "ONLINE" } });
  return "ONLINE" as const;
}

export interface LocationInput {
  lat: number;
  lng: number;
  heading?: number | null;
  speedKmh?: number | null;
  accuracyM?: number | null;
  recordedAt?: string | null;
}

/**
 * Stores the latest GPS fix. Fixes older than the stored one are ignored (out-of-order
 * delivery after reconnect). The passenger of an active ride receives the update in realtime.
 */
export async function updateDriverLocation(driverId: string, input: LocationInput) {
  const minInterval = await getSetting<number>("location_update_min_interval_seconds", 3);
  const limit = await hitRateLimit(`loc:${driverId}`, 1, Math.max(1, minInterval - 1));
  if (!limit.allowed) return { accepted: false as const, reason: "THROTTLED" };

  const now = Date.now();
  let recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date(now);
  if (Number.isNaN(recordedAt.getTime()) || recordedAt.getTime() > now + 30_000) recordedAt = new Date(now);
  if (now - recordedAt.getTime() > 10 * 60_000) return { accepted: false as const, reason: "TOO_OLD" };

  const rows = await db().$queryRaw<{ driver_id: string }[]>`
    INSERT INTO driver_locations (driver_id, lat, lng, heading, speed_kmh, accuracy_m, recorded_at, updated_at)
    VALUES (${driverId}::uuid, ${input.lat}, ${input.lng}, ${input.heading ?? null}, ${input.speedKmh ?? null}, ${input.accuracyM ?? null}, ${recordedAt}, now())
    ON CONFLICT (driver_id) DO UPDATE SET
      lat = EXCLUDED.lat, lng = EXCLUDED.lng, heading = EXCLUDED.heading, speed_kmh = EXCLUDED.speed_kmh,
      accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at, updated_at = now()
    WHERE driver_locations.recorded_at <= EXCLUDED.recorded_at
    RETURNING driver_id::text`;
  if (rows.length === 0) return { accepted: false as const, reason: "STALE" };

  const ride = await db().ride.findFirst({
    where: { driverId, status: { in: LIVE_TRACKING_STATUSES } },
    select: { id: true, passengerId: true },
  });
  if (ride) {
    await publish(db(), {
      type: "driver.location",
      audience: [ride.passengerId],
      rideId: ride.id,
      data: { lat: input.lat, lng: input.lng, heading: input.heading ?? null, recordedAt: recordedAt.toISOString() },
    });
  }
  return { accepted: true as const };
}

export async function getPendingOffer(driverId: string) {
  const offer = await db().rideOffer.findFirst({
    where: { driverId, status: "PENDING", expiresAt: { gt: new Date() } },
    include: { ride: true },
    orderBy: { createdAt: "desc" },
  });
  if (!offer) return null;
  const r = offer.ride;
  return {
    id: offer.id,
    rideId: r.id,
    expiresAt: offer.expiresAt,
    pickupEtaSeconds: offer.etaSeconds,
    pickupDistanceMeters: offer.distanceMeters,
    pickup: { lat: r.pickupLat, lng: r.pickupLng, address: r.pickupAddress },
    dropoff: { lat: r.dropoffLat, lng: r.dropoffLng, address: r.dropoffAddress },
    tripDistanceMeters: r.distanceMeters,
    tripDurationSeconds: r.durationSeconds,
    fare: r.quotedFare,
    paymentMethod: r.paymentMethod,
    vehicleClass: r.vehicleClass,
    note: r.passengerNote,
  };
}

/** Earnings for the driver's local day plus outstanding commission. */
export async function driverEarnings(driverId: string, timeZone = "Asia/Tashkent", days = 7) {
  const todayStart = startOfLocalDay(new Date(), timeZone);
  const since = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
  const rows = await db().ride.findMany({
    where: { driverId, status: { in: ["SETTLED", "COMPLETED"] }, completedAt: { gte: since } },
    select: { completedAt: true, finalFare: true, commissionAmount: true, driverEarnings: true, status: true },
  });
  const byDay = new Map<string, { date: string; rides: number; gross: number; commission: number; net: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { date: new Date(d.getTime() + 12 * 3600_000).toISOString().slice(0, 10), rides: 0, gross: 0, commission: 0, net: 0 });
  }
  let today = { rides: 0, gross: 0, commission: 0, net: 0 };
  for (const r of rows) {
    const dayStart = startOfLocalDay(r.completedAt!, timeZone);
    const bucket = byDay.get(dayStart.toISOString().slice(0, 10));
    const g = r.finalFare ?? 0;
    const c = r.commissionAmount ?? 0;
    const n = r.driverEarnings ?? 0;
    if (bucket) {
      bucket.rides++;
      bucket.gross += g;
      bucket.commission += c;
      bucket.net += n;
    }
    if (r.completedAt! >= todayStart) today = { rides: today.rides + 1, gross: today.gross + g, commission: today.commission + c, net: today.net + n };
  }
  return { today, days: [...byDay.values()], outstandingCommission: await driverOutstandingCommission(driverId) };
}
