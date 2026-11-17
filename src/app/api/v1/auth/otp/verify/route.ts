import { z } from "zod";
import { cookies } from "next/headers";
import { route, json, parseJson, clientIp, userAgent } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { normalizeUzPhone } from "@/lib/phone";
import { assertOtpCode, verifyOtp } from "@/lib/auth/otp";
import { createSession, sessionCookieOptions } from "@/lib/auth/session";
import { completeLogin } from "@/features/auth/service";
import { appSchema, phoneInputSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

const schema = z.object({
  challengeId: z.string().uuid(),
  phone: phoneInputSchema,
  code: z.string().trim(),
  app: appSchema,
  fullName: z.string().trim().min(2).max(80).nullish(),
});

export const POST = route(async (req) => {
  const body = await parseJson(req, schema);
  const phone = normalizeUzPhone(body.phone);
  if (!phone) throw Errors.badRequest("INVALID_PHONE", "Telefon raqami noto‘g‘ri.");
  assertOtpCode(body.code);
  const ip = clientIp(req);
  await verifyOtp(body.challengeId, phone, body.code, ip);
  const user = await completeLogin(phone, body.app, body.fullName);
  const { token, expiresAt } = await createSession(user.id, body.app, { ip, userAgent: userAgent(req) });
  const store = await cookies();
  store.set({ ...sessionCookieOptions(body.app, expiresAt), value: token });
  if (body.app === "admin") await audit({ actorId: user.id, action: "staff.login", entityType: "user", entityId: user.id, ip, userAgent: userAgent(req) });
  return json({ user: { id: user.id, phone: user.phone, fullName: user.fullName }, app: body.app, expiresAt });
});
