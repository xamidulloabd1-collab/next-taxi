import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/lib/db/prisma";
import { anonymizeUser, runRetention } from "@/features/privacy/service";
import { requestOtp } from "@/lib/auth/otp";
import { createSession, resolveSessionToken } from "@/lib/auth/session";
import { createQuotes } from "@/features/pricing/service";
import { createRide } from "@/features/rides/service";
import { DROPOFF, PICKUP, createCity, createPassenger, truncateAll, uniquePhone } from "../helpers/factories";

beforeEach(truncateAll);
afterAll(disconnectDb);

describe("retention and account deletion", () => {
  it("purges expired OTP challenges and unused quotes but keeps recent data", async () => {
    await createCity();
    const p = await createPassenger();
    const fresh = await requestOtp(uniquePhone(), "9.9.9.9");
    const old = await requestOtp(uniquePhone(), "9.9.9.8");
    await db().otpChallenge.update({ where: { id: old.challengeId }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const [q] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    await db().fareQuote.update({ where: { id: q!.id }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const r = await runRetention();
    expect(r.otpChallenges).toBe(1);
    expect(r.unusedQuotes).toBe(1);
    expect(await db().otpChallenge.findUnique({ where: { id: fresh.challengeId } })).not.toBeNull();
  });

  it("anonymises identifiers, kills sessions, keeps ride history, refuses during an active ride", async () => {
    await createCity();
    const p = await createPassenger();
    const { token } = await createSession(p.id, "passenger", {});
    const [q] = await createQuotes(p.id, { pickup: PICKUP, dropoff: DROPOFF });
    const ride = await createRide(p.id, { quoteId: q!.id });
    await expect(anonymizeUser(p.id, null)).rejects.toMatchObject({ code: "ACTIVE_RIDE" });
    await db().ride.update({ where: { id: ride.id }, data: { status: "CANCELLED" } });
    await anonymizeUser(p.id, null);
    const u = await db().user.findUniqueOrThrow({ where: { id: p.id } });
    expect(u.phone).toBe(`deleted:${p.id}`);
    expect(u.fullName).toBeNull();
    expect(await resolveSessionToken(token, "passenger")).toBeNull();
    expect(await db().ride.count({ where: { passengerId: p.id } })).toBe(1);
    expect(await db().auditLog.count({ where: { action: "user.anonymize", entityId: p.id } })).toBe(1);
  });
});
