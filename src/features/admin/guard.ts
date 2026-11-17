import type { NextRequest } from "next/server";
import { route, clientIp, userAgent, type RouteContext } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission, type Permission } from "@/lib/permissions";
import type { StaffMeta } from "@/features/admin/service";

/** Admin route wrapper: staff session + server-side permission check + audit metadata. */
export function adminRoute<P extends Record<string, string> = Record<string, string>>(
  permission: Permission,
  fn: (req: NextRequest, meta: StaffMeta, params: P) => Promise<Response>,
) {
  return route<P>(async (req: NextRequest, ctx: RouteContext<P>) => {
    const auth = await requireAuth("admin");
    requirePermission(auth, permission);
    return fn(req, { ctx: auth, ip: clientIp(req), userAgent: userAgent(req) }, await ctx.params);
  });
}
