import { db, withTransaction } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { PASSENGER_ACTIVE_STATUSES, DRIVER_ACTIVE_STATUSES } from "@/features/rides/state-machine";

/**
 * Retention windows (days). Starting points for legal review — see
 * docs/compliance/privacy-retention-checklist.md. Financial records (rides, payments, ledger,
 * settlements) are NOT purged here: they are kept for accounting/tax obligations and are
 * de-identified through account anonymisation instead.
 */
export const RETENTION_DAYS = {
  otpChallenges: 30,
  revokedOrExpiredSessions: 30,
  idempotencyKeys: 7,
  fareQuotesUnused: 30,
  closedSupportTickets: 730,
};

export async function runRetention(now = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const [otp, sessions, idem, quotes, rateLimits] = await Promise.all([
    db().otpChallenge.deleteMany({ where: { createdAt: { lt: days(RETENTION_DAYS.otpChallenges) } } }),
    db().session.deleteMany({ where: { OR: [{ expiresAt: { lt: days(RETENTION_DAYS.revokedOrExpiredSessions) } }, { revokedAt: { lt: days(RETENTION_DAYS.revokedOrExpiredSessions) } }] } }),
    db().idempotencyKey.deleteMany({ where: { createdAt: { lt: days(RETENTION_DAYS.idempotencyKeys) } } }),
    db().fareQuote.deleteMany({ where: { usedAt: null, createdAt: { lt: days(RETENTION_DAYS.fareQuotesUnused) } } }),
    db().$executeRaw`DELETE FROM rate_limit_buckets WHERE reset_at < ${now}`,
  ]);
  return { otpChallenges: otp.count, sessions: sessions.count, idempotencyKeys: idem.count, unusedQuotes: quotes.count, rateLimitBuckets: Number(rateLimits) };
}

/**
 * Account deletion: removes direct identifiers (phone, name), sessions, GPS position and pending
 * applications while keeping de-identified ride and financial history. Refused while the user
 * has an active ride or (for drivers) unpaid commission.
 */
export async function anonymizeUser(userId: string, staffId: string | null, meta: { ip?: string; userAgent?: string | null } = {}) {
  return withTransaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!user) throw Errors.notFound("Foydalanuvchi");
    if (user.deletedAt) throw Errors.conflict("ALREADY_ANONYMIZED", "Hisob allaqachon o‘chirilgan.");
    const active = await tx.ride.count({
      where: { OR: [{ passengerId: userId, status: { in: PASSENGER_ACTIVE_STATUSES } }, { driverId: userId, status: { in: [...DRIVER_ACTIVE_STATUSES, "COMPLETED"] } }] },
    });
    if (active) throw Errors.conflict("ACTIVE_RIDE", "Faol buyurtma tugaguncha hisobni o‘chirib bo‘lmaydi.");
    const [debt] = await tx.$queryRaw<{ b: bigint | null }[]>`
      SELECT SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END)::bigint AS b
        FROM ledger_entries WHERE driver_id = ${userId}::uuid AND account = 'DRIVER_COMMISSION_RECEIVABLE'`;
    if (Number(debt?.b ?? 0) > 0) throw Errors.conflict("OUTSTANDING_COMMISSION", "Haydovchida to‘lanmagan komissiya bor.");

    await tx.user.update({ where: { id: userId }, data: { phone: `deleted:${userId}`, fullName: null, status: "BLOCKED", deletedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.driverLocation.deleteMany({ where: { driverId: userId } });
    await tx.driverProfile.updateMany({ where: { userId }, data: { availability: "OFFLINE", licenseNumber: null } });
    await tx.rideOffer.updateMany({ where: { driverId: userId, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.otpChallenge.deleteMany({ where: { phone: user.phone } });
    await audit({ actorId: staffId, action: "user.anonymize", entityType: "user", entityId: userId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    // Driver document files are deleted by the caller after commit (storage is outside the transaction).
    return tx.driverDocument.findMany({ where: { driverId: userId }, select: { id: true, storageKey: true } });
  });
}
