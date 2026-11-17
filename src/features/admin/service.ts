import type { CityStatus, DriverStatus, IncidentStatus, Prisma, ReviewStatus, Role, VehicleClass, VehicleStatus } from "@prisma/client";
import { db, withTransaction } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { revokeAllSessions, STAFF_ROLES } from "@/lib/auth/session";
import { requireCityAccess } from "@/lib/permissions";
import type { AuthContext } from "@/lib/auth/session";
import { validatePolygon } from "@/lib/maps/geo";
import { publish, STAFF_AUDIENCE } from "@/lib/realtime/events";
import { REQUIRED_DOCUMENTS } from "@/features/drivers/service";

export interface StaffMeta {
  ctx: AuthContext;
  ip?: string;
  userAgent?: string | null;
}
const meta = (m: StaffMeta) => ({ actorId: m.ctx.userId, ip: m.ip, userAgent: m.userAgent });

// ───────────── Driver verification ─────────────

export async function reviewDocument(m: StaffMeta, documentId: string, status: ReviewStatus, rejectionReason?: string | null) {
  if (status === "REJECTED" && !rejectionReason?.trim()) throw Errors.badRequest("REASON_REQUIRED", "Rad etish sababini kiriting.");
  const before = await db().driverDocument.findUnique({ where: { id: documentId } });
  if (!before) throw Errors.notFound("Hujjat");
  const after = await db().driverDocument.update({
    where: { id: documentId },
    data: { status, rejectionReason: status === "REJECTED" ? rejectionReason!.trim() : null, reviewedById: m.ctx.userId, reviewedAt: new Date() },
  });
  await audit({ ...meta(m), action: `document.${status.toLowerCase()}`, entityType: "driver_document", entityId: documentId, before: { status: before.status }, after: { status, rejectionReason } });
  return after;
}

export async function reviewVehicle(m: StaffMeta, vehicleId: string, status: VehicleStatus, rejectionReason?: string | null) {
  if (status === "REJECTED" && !rejectionReason?.trim()) throw Errors.badRequest("REASON_REQUIRED", "Rad etish sababini kiriting.");
  const before = await db().vehicle.findUnique({ where: { id: vehicleId } });
  if (!before) throw Errors.notFound("Avtomobil");
  const after = await db().vehicle.update({
    where: { id: vehicleId },
    data: { status, rejectionReason: status === "REJECTED" ? rejectionReason!.trim() : null, reviewedById: m.ctx.userId, reviewedAt: new Date() },
  });
  await audit({ ...meta(m), action: `vehicle.${status.toLowerCase()}`, entityType: "vehicle", entityId: vehicleId, before: { status: before.status }, after: { status, rejectionReason } });
  return after;
}

/**
 * Approves a driver only when every required document is approved and the active vehicle is approved.
 * Rejection returns the application to the driver with a reason.
 */
export async function decideDriver(m: StaffMeta, driverId: string, decision: "APPROVE" | "REJECT", reason?: string | null) {
  const profile = await db().driverProfile.findUnique({
    where: { userId: driverId },
    include: { documents: true, vehicles: { where: { isActive: true }, include: { vehicle: true } } },
  });
  if (!profile) throw Errors.notFound("Haydovchi");
  if (profile.cityId) requireCityAccess(m.ctx, profile.cityId);
  let status: DriverStatus;
  if (decision === "APPROVE") {
    const latest = new Map<string, ReviewStatus>();
    for (const d of [...profile.documents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) if (!latest.has(d.type)) latest.set(d.type, d.status);
    const notApproved = REQUIRED_DOCUMENTS.filter((t) => latest.get(t) !== "APPROVED");
    if (notApproved.length) throw Errors.badRequest("DOCUMENTS_NOT_APPROVED", "Barcha majburiy hujjatlar tasdiqlanmagan.", { notApproved });
    if (profile.vehicles[0]?.vehicle.status !== "APPROVED") throw Errors.badRequest("VEHICLE_NOT_APPROVED", "Avtomobil tasdiqlanmagan.");
    if (!profile.cityId || !profile.licenseNumber) throw Errors.badRequest("PROFILE_INCOMPLETE", "Haydovchi profili to‘liq emas.");
    status = "APPROVED";
  } else {
    if (!reason?.trim()) throw Errors.badRequest("REASON_REQUIRED", "Rad etish sababini kiriting.");
    status = "REJECTED";
  }
  const after = await db().driverProfile.update({
    where: { userId: driverId },
    data:
      status === "APPROVED"
        ? { status, approvedAt: new Date(), approvedById: m.ctx.userId, rejectionReason: null }
        : { status, rejectionReason: reason!.trim(), availability: "OFFLINE" },
  });
  await audit({ ...meta(m), action: `driver.${decision.toLowerCase()}`, entityType: "driver", entityId: driverId, before: { status: profile.status }, after: { status, reason } });
  await publish(db(), { type: "driver.status", audience: [driverId, STAFF_AUDIENCE], data: { status } });
  return after;
}

export async function setDriverSuspension(m: StaffMeta, driverId: string, suspend: boolean, reason?: string | null) {
  const profile = await db().driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile) throw Errors.notFound("Haydovchi");
  if (profile.cityId) requireCityAccess(m.ctx, profile.cityId);
  if (suspend && !reason?.trim()) throw Errors.badRequest("REASON_REQUIRED", "To‘xtatish sababini kiriting.");
  if (!suspend && profile.status !== "SUSPENDED") throw Errors.conflict("NOT_SUSPENDED", "Haydovchi to‘xtatilmagan.");
  const after = await db().driverProfile.update({
    where: { userId: driverId },
    data: suspend ? { status: "SUSPENDED", suspendedReason: reason!.trim(), availability: "OFFLINE" } : { status: "APPROVED", suspendedReason: null },
  });
  if (suspend) await db().rideOffer.updateMany({ where: { driverId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
  await audit({ ...meta(m), action: suspend ? "driver.suspend" : "driver.unsuspend", entityType: "driver", entityId: driverId, before: { status: profile.status }, after: { status: after.status, reason } });
  await publish(db(), { type: "driver.status", audience: [driverId, STAFF_AUDIENCE], data: { status: after.status } });
  return after;
}

/** Blocks/unblocks any end-user account and revokes their sessions. Staff accounts are managed separately. */
export async function setUserBlocked(m: StaffMeta, userId: string, blocked: boolean, reason: string) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user) throw Errors.notFound("Foydalanuvchi");
  if (user.roles.some((r) => STAFF_ROLES.includes(r.role)) && !m.ctx.roles.includes("SUPER_ADMIN")) throw Errors.forbidden();
  if (userId === m.ctx.userId) throw Errors.badRequest("SELF_BLOCK", "O‘zingizni bloklay olmaysiz.");
  const after = await db().user.update({ where: { id: userId }, data: { status: blocked ? "BLOCKED" : "ACTIVE" } });
  if (blocked) {
    await revokeAllSessions(userId);
    await db().driverProfile.updateMany({ where: { userId }, data: { availability: "OFFLINE" } });
  }
  await audit({ ...meta(m), action: blocked ? "user.block" : "user.unblock", entityType: "user", entityId: userId, before: { status: user.status }, after: { status: after.status, reason } });
  return after;
}

// ───────────── Cities, zones, tariffs ─────────────

export interface CityUpdate {
  status?: CityStatus;
  centerLat?: number | null;
  centerLng?: number | null;
  defaultZoom?: number;
  operatingHoursStart?: string;
  operatingHoursEnd?: string;
  searchRadiusMeters?: number;
  offerTimeoutSeconds?: number;
  offerBatchSize?: number;
  maxOffersPerRide?: number;
  searchTimeoutSeconds?: number;
  maxDriverDebt?: number;
}

export async function updateCity(m: StaffMeta, cityId: string, data: CityUpdate) {
  requireCityAccess(m.ctx, cityId);
  const before = await db().city.findUnique({ where: { id: cityId } });
  if (!before) throw Errors.notFound("Shahar");
  if (data.status === "ACTIVE") {
    const lat = data.centerLat ?? before.centerLat;
    const lng = data.centerLng ?? before.centerLng;
    const [zones, tariffs] = await Promise.all([
      db().serviceZone.count({ where: { cityId, isActive: true } }),
      db().tariff.count({ where: { cityId, isActive: true } }),
    ]);
    const missing: string[] = [];
    if (lat == null || lng == null) missing.push("markaz koordinatalari");
    if (zones === 0) missing.push("faol xizmat hududi");
    if (tariffs === 0) missing.push("faol tarif");
    if (missing.length) throw Errors.badRequest("CITY_NOT_READY", `Shaharni faollashtirish uchun kerak: ${missing.join(", ")}.`, { missing });
  }
  const after = await db().city.update({ where: { id: cityId }, data });
  await audit({ ...meta(m), action: "city.update", entityType: "city", entityId: cityId, before, after });
  return after;
}

export async function saveZone(m: StaffMeta, input: { id?: string; cityId: string; name: string; boundary: unknown; isActive: boolean; note?: string | null }) {
  requireCityAccess(m.ctx, input.cityId);
  const polygon = validatePolygon(input.boundary);
  if (!polygon) throw Errors.badRequest("INVALID_POLYGON", "Hudud chegarasi noto‘g‘ri (kamida 3 ta nuqtali yopiq ko‘pburchak).");
  const data = { cityId: input.cityId, name: input.name.trim(), boundary: polygon as unknown as Prisma.InputJsonValue, isActive: input.isActive, note: input.note ?? null };
  try {
    if (input.id) {
      const before = await db().serviceZone.findUnique({ where: { id: input.id } });
      if (!before || before.cityId !== input.cityId) throw Errors.notFound("Hudud");
      const after = await db().serviceZone.update({ where: { id: input.id }, data });
      await audit({ ...meta(m), action: "zone.update", entityType: "service_zone", entityId: input.id, before, after });
      return after;
    }
    const after = await db().serviceZone.create({ data });
    await audit({ ...meta(m), action: "zone.create", entityType: "service_zone", entityId: after.id, after });
    return after;
  } catch (err) {
    const msg = String((err as Error).message);
    if (msg.includes("ZONE_")) throw Errors.badRequest("INVALID_POLYGON", "Hudud chegarasi geometrik jihatdan noto‘g‘ri (chiziqlar kesishmasin).");
    throw err;
  }
}

export interface TariffInput {
  cityId: string;
  vehicleClass: VehicleClass;
  name: string;
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  roundingStep: number;
  commissionBps: number;
  quoteTtlSeconds: number;
}

/** Publishes a new tariff version; the previous active version is retired, never edited. */
export async function publishTariffVersion(m: StaffMeta, input: TariffInput) {
  requireCityAccess(m.ctx, input.cityId);
  return withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM cities WHERE id = ${input.cityId}::uuid FOR UPDATE`;
    const prev = await tx.tariff.findFirst({ where: { cityId: input.cityId, vehicleClass: input.vehicleClass }, orderBy: { version: "desc" } });
    const active = await tx.tariff.findFirst({ where: { cityId: input.cityId, vehicleClass: input.vehicleClass, isActive: true } });
    if (active) await tx.tariff.update({ where: { id: active.id }, data: { isActive: false, supersededAt: new Date() } });
    const created = await tx.tariff.create({ data: { ...input, version: (prev?.version ?? 0) + 1, isActive: true, createdById: m.ctx.userId } });
    await audit({ ...meta(m), action: "tariff.publish", entityType: "tariff", entityId: created.id, before: active, after: created }, tx);
    return created;
  });
}

export async function deactivateTariff(m: StaffMeta, tariffId: string) {
  const t = await db().tariff.findUnique({ where: { id: tariffId } });
  if (!t) throw Errors.notFound("Tarif");
  requireCityAccess(m.ctx, t.cityId);
  const after = await db().tariff.update({ where: { id: tariffId }, data: { isActive: false, supersededAt: new Date() } });
  await audit({ ...meta(m), action: "tariff.deactivate", entityType: "tariff", entityId: tariffId, before: t, after });
  return after;
}

// ───────────── Incidents & staff ─────────────

export async function updateIncident(m: StaffMeta, incidentId: string, status: IncidentStatus, resolution?: string | null) {
  const before = await db().safetyIncident.findUnique({ where: { id: incidentId } });
  if (!before) throw Errors.notFound("Hodisa");
  if (status === "RESOLVED" && !resolution?.trim()) throw Errors.badRequest("RESOLUTION_REQUIRED", "Yechimni yozing.");
  const after = await db().safetyIncident.update({ where: { id: incidentId }, data: { status, resolution: resolution?.trim() || before.resolution, handledById: m.ctx.userId } });
  await audit({ ...meta(m), action: "incident.update", entityType: "safety_incident", entityId: incidentId, before, after });
  return after;
}

export async function grantStaffRole(m: StaffMeta, phone: string, role: Role, cityId: string | null, fullName?: string | null) {
  if (!STAFF_ROLES.includes(role)) throw Errors.badRequest("INVALID_ROLE", "Noto‘g‘ri rol.");
  const user = await db().user.upsert({ where: { phone }, create: { phone, fullName: fullName ?? null }, update: {} });
  const row = await db().userRole.upsert({
    where: { userId_role: { userId: user.id, role } },
    create: { userId: user.id, role, cityId },
    update: { cityId },
  });
  await audit({ ...meta(m), action: "staff.grant", entityType: "user", entityId: user.id, after: { role, cityId } });
  return row;
}

export async function revokeStaffRole(m: StaffMeta, userId: string, role: Role) {
  if (userId === m.ctx.userId && role === "SUPER_ADMIN") throw Errors.badRequest("SELF_REVOKE", "O‘zingizdan bosh administrator huquqini olib bo‘lmaydi.");
  const res = await db().userRole.deleteMany({ where: { userId, role } });
  if (res.count === 0) throw Errors.notFound("Rol");
  await revokeAllSessions(userId);
  await audit({ ...meta(m), action: "staff.revoke", entityType: "user", entityId: userId, before: { role } });
}
