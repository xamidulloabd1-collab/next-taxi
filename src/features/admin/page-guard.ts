import { redirect } from "next/navigation";
import { getAuth, STAFF_ROLES, type AuthContext } from "@/lib/auth/session";
import { hasPermission, type Permission } from "@/lib/permissions";

/** Server-component guard: redirects signed-out users; returns null when the permission is missing. */
export async function staffPage(permission: Permission): Promise<AuthContext | null> {
  const ctx = await getAuth("admin");
  if (!ctx || !ctx.roles.some((r) => STAFF_ROLES.includes(r))) redirect("/admin/login");
  return hasPermission(ctx, permission) ? ctx : null;
}
