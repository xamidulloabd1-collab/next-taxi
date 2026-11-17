import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/lib/db/prisma";
import { requestOtp, verifyOtp, OTP_MAX_ATTEMPTS } from "@/lib/auth/otp";
import { createSession, resolveSessionToken } from "@/lib/auth/session";
import { completeLogin } from "@/features/auth/service";
import { setOtpSenderForTests } from "@/lib/auth/otp-delivery";
import { AppError } from "@/lib/errors";
import { createStaff, truncateAll, uniquePhone } from "../helpers/factories";

beforeEach(truncateAll);
afterAll(disconnectDb);

describe("OTP authentication", () => {
  it("issues a hashed code and verifies it exactly once", async () => {
    const phone = uniquePhone();
    const r = await requestOtp(phone, "1.1.1.1");
    expect(r.devCode).toMatch(/^\d{6}$/);
    const row = await db().otpChallenge.findUniqueOrThrow({ where: { id: r.challengeId } });
    expect(row.codeHash).not.toContain(r.devCode!); // stored as HMAC, never plain text
    await verifyOtp(r.challengeId, phone, r.devCode!, "1.1.1.1");
    await expect(verifyOtp(r.challengeId, phone, r.devCode!, "1.1.1.1")).rejects.toMatchObject({ code: "OTP_INVALID" });
  });

  it("rejects wrong codes and locks the challenge after the attempt limit", async () => {
    const phone = uniquePhone();
    const r = await requestOtp(phone, "1.1.1.2");
    const wrong = r.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(verifyOtp(r.challengeId, phone, wrong, "1.1.1.2")).rejects.toMatchObject({ code: "OTP_INVALID" });
    }
    // Even the correct code fails once attempts are exhausted.
    await expect(verifyOtp(r.challengeId, phone, r.devCode!, "1.1.1.2")).rejects.toMatchObject({ code: "OTP_INVALID" });
  });

  it("does not allow a code for one phone to be used for another", async () => {
    const r = await requestOtp(uniquePhone(), "1.1.1.3");
    await expect(verifyOtp(r.challengeId, uniquePhone(), r.devCode!, "1.1.1.3")).rejects.toMatchObject({ code: "OTP_INVALID" });
  });

  it("rate limits OTP requests per phone", async () => {
    const phone = uniquePhone();
    for (let i = 0; i < 3; i++) await requestOtp(phone, `2.2.2.${i}`);
    await expect(requestOtp(phone, "2.2.2.9")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("parallel guesses cannot exceed the attempt limit", async () => {
    const phone = uniquePhone();
    const r = await requestOtp(phone, "1.1.1.4");
    const wrong = r.devCode === "999999" ? "888888" : "999999";
    await Promise.allSettled(Array.from({ length: 12 }, () => verifyOtp(r.challengeId, phone, wrong, "1.1.1.4")));
    const row = await db().otpChallenge.findUniqueOrThrow({ where: { id: r.challengeId } });
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS);
  });
});

describe("OTP delivery channel", () => {
  it("reports the channel used and never stores a deliverable code when delivery fails", async () => {
    const sent: string[] = [];
    setOtpSenderForTests({ name: "telegram", sendCode: async (phone) => (sent.push(phone), { channel: "telegram" }) });
    const phone = uniquePhone();
    const ok = await requestOtp(phone, "3.3.3.3");
    expect(ok.channel).toBe("telegram");
    expect(sent).toEqual([phone]);

    setOtpSenderForTests({ name: "telegram", sendCode: async () => { throw new AppError("OTP_NO_TELEGRAM", 400, "no telegram"); } });
    const phone2 = uniquePhone();
    await expect(requestOtp(phone2, "3.3.3.4")).rejects.toMatchObject({ code: "OTP_NO_TELEGRAM" });
    const row = await db().otpChallenge.findFirstOrThrow({ where: { phone: phone2 } });
    expect(row.consumedAt).not.toBeNull(); // invalidated: cannot be verified
    setOtpSenderForTests(null);
  });
});

describe("login and sessions", () => {
  it("creates passenger and driver roles/profiles on first login", async () => {
    const phone = uniquePhone();
    const p = await completeLogin(phone, "passenger", "Ali Valiyev");
    await completeLogin(phone, "driver");
    const roles = await db().userRole.findMany({ where: { userId: p.id } });
    expect(roles.map((r) => r.role).sort()).toEqual(["DRIVER", "PASSENGER"]);
    expect(await db().driverProfile.findUnique({ where: { userId: p.id } })).toMatchObject({ status: "PENDING_DOCUMENTS" });
  });

  it("refuses admin login for non-staff numbers", async () => {
    const phone = uniquePhone();
    await completeLogin(phone, "passenger");
    await expect(completeLogin(phone, "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sessions are bound to an app, expire, and die when the user is blocked", async () => {
    const user = await completeLogin(uniquePhone(), "passenger");
    const { token } = await createSession(user.id, "passenger", {});
    expect((await resolveSessionToken(token, "passenger"))?.userId).toBe(user.id);
    expect(await resolveSessionToken(token, "admin")).toBeNull();
    expect(await resolveSessionToken(token, "driver")).toBeNull();
    await db().user.update({ where: { id: user.id }, data: { status: "BLOCKED" } });
    expect(await resolveSessionToken(token, "passenger")).toBeNull();
  });

  it("expired sessions are rejected", async () => {
    const user = await completeLogin(uniquePhone(), "passenger");
    const { token } = await createSession(user.id, "passenger", {});
    await db().session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveSessionToken(token, "passenger")).toBeNull();
  });

  it("staff login works for staff roles", async () => {
    const { user } = await createStaff("SUPPORT_OPERATOR");
    const u = await completeLogin(user.phone, "admin");
    expect(u.id).toBe(user.id);
  });
});
