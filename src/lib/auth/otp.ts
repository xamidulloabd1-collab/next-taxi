import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { Errors, AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getOtpSender, type OtpChannel } from "@/lib/auth/otp-delivery";

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;

function hashCode(phone: string, code: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(`otp:${phone}:${code}`).digest("hex");
}

export interface OtpRequestResult {
  challengeId: string;
  expiresAt: Date;
  /** Where the code went (null when sending was skipped, e.g. admin login for a non-staff number). */
  channel: OtpChannel | null;
  /** Only present when OTP_DEV_ECHO=true (forbidden in production by env validation). */
  devCode?: string;
}

export async function requestOtp(phone: string, ip: string, opts: { send?: boolean } = {}): Promise<OtpRequestResult> {
  // Limits: 3 codes / 10 min per phone, 10 / day per phone, 20 / hour per IP.
  await enforceRateLimit(`otp:phone:${phone}`, 3, 600);
  await enforceRateLimit(`otp:phone-day:${phone}`, 10, 86_400);
  await enforceRateLimit(`otp:ip:${ip}`, 20, 3600);
  // Cost guard against SMS/Telegram pumping: cap codes per day across the whole platform.
  if (opts.send !== false) await enforceRateLimit("otp:global-day", env().OTP_GLOBAL_DAILY_LIMIT, 86_400);

  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  const challenge = await db().otpChallenge.create({
    data: { phone, codeHash: hashCode(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000), ip },
  });

  let channel: OtpChannel | null = null;
  if (opts.send !== false) {
    try {
      channel = (await getOtpSender().sendCode(phone, code, OTP_TTL_SECONDS, challenge.id)).channel;
    } catch (err) {
      // The code was never delivered: invalidate the challenge so it cannot be guessed.
      await db().otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }).catch(() => undefined);
      throw err;
    }
  }
  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    channel,
    ...(env().OTP_DEV_ECHO && env().APP_ENV !== "production" ? { devCode: code } : {}),
  };
}

/** Verifies and consumes a challenge. Each challenge allows OTP_MAX_ATTEMPTS attempts and a single success. */
export async function verifyOtp(challengeId: string, phone: string, code: string, ip: string): Promise<void> {
  await enforceRateLimit(`otp-verify:ip:${ip}`, 30, 3600);
  const invalid = new AppError("OTP_INVALID", 400, "Kod noto‘g‘ri yoki muddati o‘tgan.");

  // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
  const counted = await db().$queryRaw<{ code_hash: string; expires_at: Date }[]>`
    UPDATE otp_challenges SET attempts = attempts + 1
     WHERE id = ${challengeId}::uuid AND phone = ${phone} AND consumed_at IS NULL
       AND attempts < ${OTP_MAX_ATTEMPTS} AND expires_at > now()
    RETURNING code_hash, expires_at`;
  const row = counted[0];
  if (!row) throw invalid;

  const expected = Buffer.from(row.code_hash, "hex");
  const actual = Buffer.from(hashCode(phone, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid;

  const consumed = await db().otpChallenge.updateMany({
    where: { id: challengeId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw invalid;
}

export function assertOtpCode(code: string) {
  if (!/^\d{6}$/.test(code)) throw Errors.badRequest("OTP_FORMAT", "Kod 6 ta raqamdan iborat bo‘lishi kerak.");
}
