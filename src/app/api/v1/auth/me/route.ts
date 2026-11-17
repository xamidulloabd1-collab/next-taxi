import type { NextRequest } from "next/server";
import { route, json } from "@/lib/http";
import { getAuth, STAFF_ROLES } from "@/lib/auth/session";
import { appSchema } from "@/lib/validation";
import { Errors } from "@/lib/errors";

export const GET = route(async (req: NextRequest) => {
  const app = appSchema.parse(req.nextUrl.searchParams.get("app"));
  const ctx = await getAuth(app);
  if (!ctx) throw Errors.unauthenticated();
  return json({ id: ctx.userId, phone: ctx.phone, fullName: ctx.fullName, roles: ctx.roles, isStaff: ctx.roles.some((r) => STAFF_ROLES.includes(r)) });
});
