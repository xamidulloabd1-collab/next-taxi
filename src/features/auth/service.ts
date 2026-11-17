import type { Role } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import { STAFF_ROLES, type AppKind } from "@/lib/auth/session";

/**
 * Finds or creates the user for a verified phone number and ensures the role/profile
 * for the app being signed into. Staff accounts are never self-created.
 */
export async function completeLogin(phone: string, app: AppKind, fullName?: string | null) {
  if (app === "admin") {
    const user = await db().user.findUnique({ where: { phone }, include: { roles: true } });
    if (!user || !user.roles.some((r) => STAFF_ROLES.includes(r.role))) throw Errors.forbidden("Bu raqamga xodim huquqi berilmagan.");
    if (user.status !== "ACTIVE") throw Errors.forbidden("Hisob bloklangan.");
    return user;
  }

  const role: Role = app === "driver" ? "DRIVER" : "PASSENGER";
  return db().$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { phone }, include: { roles: true } });
    if (!user) {
      user = await tx.user.create({ data: { phone, fullName: fullName?.trim() || null }, include: { roles: true } });
    } else if (fullName && !user.fullName) {
      user = await tx.user.update({ where: { id: user.id }, data: { fullName: fullName.trim() }, include: { roles: true } });
    }
    if (user.status !== "ACTIVE" || user.deletedAt) throw Errors.forbidden("Hisob bloklangan. Qo‘llab-quvvatlash xizmatiga murojaat qiling.");
    if (!user.roles.some((r) => r.role === role)) {
      await tx.userRole.create({ data: { userId: user.id, role } });
    }
    if (role === "PASSENGER") {
      await tx.passengerProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    } else {
      await tx.driverProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    }
    return user;
  });
}
