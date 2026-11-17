import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { route, json, parseJson, clientIp } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { normalizeUzPhone } from "@/lib/phone";
import { requestOtp } from "@/lib/auth/otp";
import { STAFF_ROLES } from "@/lib/auth/session";
import { appSchema, phoneInputSchema } from "@/lib/validation";

const schema = z.object({ phone: phoneInputSchema, app: appSchema });

export const POST = route(async (req) => {
  const body = await parseJson(req, schema);
  const phone = normalizeUzPhone(body.phone);
  if (!phone) throw Errors.badRequest("INVALID_PHONE", "Telefon raqami noto‘g‘ri. Masalan: 90 123 45 67");
  let send = true;
  if (body.app === "admin") {
    // Do not reveal whether the number is staff; just skip sending SMS to non-staff numbers.
    const staff = await db().userRole.findFirst({ where: { user: { phone, status: "ACTIVE" }, role: { in: STAFF_ROLES } } });
    send = Boolean(staff);
  }
  const r = await requestOtp(phone, clientIp(req), { send });
  // For non-staff admin requests report "sms" so the response does not reveal staff numbers.
  const channel = body.app === "admin" && !send ? "sms" : r.channel;
  return json({ challengeId: r.challengeId, expiresAt: r.expiresAt, phone, channel, ...(send && r.devCode ? { devCode: r.devCode } : {}) });
});
