import type { Role } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";
import { Errors } from "@/lib/errors";

const SA: Role = "SUPER_ADMIN";
const CM: Role = "CITY_MANAGER";
const SO: Role = "SUPPORT_OPERATOR";
const FM: Role = "FINANCE_MANAGER";
const CR: Role = "COMPLIANCE_REVIEWER";

/** Server-side permission matrix. UI hiding is cosmetic; every admin route checks these. */
export const PERMISSIONS = {
  "dashboard.view": [SA, CM, SO, FM, CR],
  "rides.view": [SA, CM, SO, FM],
  "rides.manage": [SA, CM, SO],
  "passengers.view": [SA, CM, SO],
  "passengers.manage": [SA, SO],
  "drivers.view": [SA, CM, SO, FM, CR],
  "drivers.manage": [SA, CM],
  "drivers.verify": [SA, CR],
  "documents.view": [SA, CR],
  "vehicles.view": [SA, CM, CR],
  "vehicles.verify": [SA, CR],
  "cities.view": [SA, CM],
  "cities.manage": [SA, CM],
  "tariffs.view": [SA, CM, FM],
  "tariffs.manage": [SA, CM],
  "finance.view": [SA, FM],
  "settlements.manage": [SA, FM],
  "support.view": [SA, SO, CM],
  "support.manage": [SA, SO],
  "incidents.view": [SA, SO, CM],
  "incidents.manage": [SA, SO, CM],
  "settings.manage": [SA],
  "staff.manage": [SA],
  "audit.view": [SA, CR],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(ctx: Pick<AuthContext, "roles">, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return ctx.roles.some((r) => allowed.includes(r));
}

export function requirePermission(ctx: Pick<AuthContext, "roles">, permission: Permission) {
  if (!hasPermission(ctx, permission)) throw Errors.forbidden();
}

/**
 * City scoping: a CITY_MANAGER bound to a city may only act on that city. Super admins and
 * unscoped roles may act on any city.
 */
export function canAccessCity(ctx: Pick<AuthContext, "roles" | "roleCities">, cityId: string): boolean {
  if (ctx.roles.includes("SUPER_ADMIN")) return true;
  const scopedRoles = ctx.roles.filter((r) => r !== "PASSENGER" && r !== "DRIVER");
  return scopedRoles.some((r) => {
    const scope = ctx.roleCities[r];
    return scope === null || scope === undefined || scope === cityId;
  });
}

export function requireCityAccess(ctx: Pick<AuthContext, "roles" | "roleCities">, cityId: string) {
  if (!canAccessCity(ctx, cityId)) throw Errors.forbidden("Bu shahar uchun ruxsatingiz yo‘q.");
}

export const ROLE_LABELS: Record<Role, string> = {
  PASSENGER: "Yo‘lovchi",
  DRIVER: "Haydovchi",
  SUPER_ADMIN: "Bosh administrator",
  CITY_MANAGER: "Shahar menejeri",
  SUPPORT_OPERATOR: "Qo‘llab-quvvatlash operatori",
  FINANCE_MANAGER: "Moliya menejeri",
  COMPLIANCE_REVIEWER: "Hujjat tekshiruvchi",
};
