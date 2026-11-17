import { describe, expect, it } from "vitest";
import { canAccessCity, hasPermission, PERMISSIONS, type Permission } from "@/lib/permissions";

const ctx = (role: string, city: string | null = null) => ({ roles: [role], roleCities: { [role]: city } }) as never;

describe("RBAC matrix", () => {
  it("super admin has every permission", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(hasPermission(ctx("SUPER_ADMIN"), p)).toBe(true);
  });
  it("finance cannot verify drivers or edit tariffs; can record settlements", () => {
    expect(hasPermission(ctx("FINANCE_MANAGER"), "drivers.verify")).toBe(false);
    expect(hasPermission(ctx("FINANCE_MANAGER"), "tariffs.manage")).toBe(false);
    expect(hasPermission(ctx("FINANCE_MANAGER"), "settlements.manage")).toBe(true);
  });
  it("support cannot change settings, finance or staff", () => {
    for (const p of ["settings.manage", "settlements.manage", "staff.manage", "drivers.verify"] as Permission[]) {
      expect(hasPermission(ctx("SUPPORT_OPERATOR"), p)).toBe(false);
    }
  });
  it("compliance reviewer can view documents; city manager cannot", () => {
    expect(hasPermission(ctx("COMPLIANCE_REVIEWER"), "documents.view")).toBe(true);
    expect(hasPermission(ctx("CITY_MANAGER"), "documents.view")).toBe(false);
  });
  it("passengers and drivers have no admin permissions", () => {
    expect(hasPermission(ctx("PASSENGER"), "dashboard.view")).toBe(false);
    expect(hasPermission(ctx("DRIVER"), "rides.view")).toBe(false);
  });
  it("scopes city managers to their city", () => {
    expect(canAccessCity(ctx("CITY_MANAGER", "a"), "a")).toBe(true);
    expect(canAccessCity(ctx("CITY_MANAGER", "a"), "b")).toBe(false);
    expect(canAccessCity(ctx("CITY_MANAGER", null), "b")).toBe(true);
    expect(canAccessCity(ctx("SUPER_ADMIN", "a"), "b")).toBe(true);
  });
});
