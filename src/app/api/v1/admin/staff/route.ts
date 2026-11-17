import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { normalizeUzPhone } from "@/lib/phone";
import { adminRoute } from "@/features/admin/guard";
import { grantStaffRole, revokeStaffRole } from "@/features/admin/service";

const role = z.enum(["SUPER_ADMIN", "CITY_MANAGER", "SUPPORT_OPERATOR", "FINANCE_MANAGER", "COMPLIANCE_REVIEWER"]);

export const POST = adminRoute("staff.manage", async (req, meta) => {
  const body = await parseJson(req, z.object({ phone: z.string(), role, cityId: z.string().uuid().nullish(), fullName: z.string().trim().max(80).nullish() }));
  const phone = normalizeUzPhone(body.phone);
  if (!phone) throw Errors.badRequest("INVALID_PHONE", "Telefon raqami noto‘g‘ri.");
  const r = await grantStaffRole(meta, phone, body.role, body.cityId ?? null, body.fullName);
  return json({ role: r }, { status: 201 });
});

export const DELETE = adminRoute("staff.manage", async (req, meta) => {
  const body = await parseJson(req, z.object({ userId: z.string().uuid(), role }));
  await revokeStaffRole(meta, body.userId, body.role);
  return json({ ok: true });
});
