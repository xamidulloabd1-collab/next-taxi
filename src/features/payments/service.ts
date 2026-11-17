import { randomUUID } from "node:crypto";
import type { Ride, SettlementMethod } from "@prisma/client";
import { db, withTransaction, type Db, type Tx } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { calculateCommission } from "@/features/pricing/fare";

/**
 * Money model (MVP, cash only):
 *  - The passenger pays the full fare in cash to the driver. The platform receives nothing at that moment.
 *  - On cash confirmation the platform's commission becomes a receivable owed by the driver:
 *      DR DRIVER_COMMISSION_RECEIVABLE / CR PLATFORM_COMMISSION_REVENUE
 *  - When finance staff record the driver paying the commission (office cash, bank/card transfer):
 *      DR PLATFORM_CASH / CR DRIVER_COMMISSION_RECEIVABLE
 * A payment record with status COLLECTED_BY_DRIVER is the driver's confirmation, not proof that the platform received money.
 */

export function splitForRide(ride: Pick<Ride, "quotedFare" | "commissionBps">) {
  // Upfront pricing: the final fare equals the accepted quote.
  return calculateCommission(ride.quotedFare, ride.commissionBps);
}

export async function createPendingPayment(tx: Tx, ride: Ride) {
  const split = splitForRide(ride);
  return tx.payment.create({
    data: {
      rideId: ride.id,
      method: ride.paymentMethod,
      status: "PENDING",
      amount: split.fare,
      commissionAmount: split.commission,
      driverEarnings: split.driverEarnings,
    },
  });
}

export async function postCommissionAccrual(tx: Tx, ride: Ride, actorId: string | null) {
  if (!ride.driverId) throw new Error("Ride has no driver");
  const commission = ride.commissionAmount ?? 0;
  if (commission <= 0) return null;
  const transactionId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: [
      {
        transactionId,
        eventType: "COMMISSION_ACCRUED",
        account: "DRIVER_COMMISSION_RECEIVABLE",
        direction: "DEBIT",
        amount: commission,
        rideId: ride.id,
        driverId: ride.driverId,
        createdById: actorId,
        memo: `Komissiya ${ride.code}`,
      },
      {
        transactionId,
        eventType: "COMMISSION_ACCRUED",
        account: "PLATFORM_COMMISSION_REVENUE",
        direction: "CREDIT",
        amount: commission,
        rideId: ride.id,
        driverId: ride.driverId,
        createdById: actorId,
        memo: `Komissiya ${ride.code}`,
      },
    ],
  });
  return transactionId;
}

/** Outstanding commission the driver owes the platform (UZS). */
export async function driverOutstandingCommission(driverId: string, client: Db = db()): Promise<number> {
  const rows = await client.$queryRaw<{ balance: bigint | null }[]>`
    SELECT SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END)::bigint AS balance
      FROM ledger_entries
     WHERE driver_id = ${driverId}::uuid AND account = 'DRIVER_COMMISSION_RECEIVABLE'`;
  return Number(rows[0]?.balance ?? 0);
}

export interface SettlementInput {
  driverId: string;
  amount: number;
  method: SettlementMethod;
  reference?: string | null;
  note?: string | null;
}

/** Records a driver's commission payment to the platform. Locks the driver row to serialise settlements. */
export async function recordSettlement(input: SettlementInput, staff: { userId: string; ip?: string; userAgent?: string | null }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw Errors.badRequest("INVALID_AMOUNT", "Summa musbat butun son bo‘lishi kerak.");
  return withTransaction(async (tx) => {
    const locked = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT user_id::text FROM driver_profiles WHERE user_id = ${input.driverId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw Errors.notFound("Haydovchi");
    const outstanding = await driverOutstandingCommission(input.driverId, tx);
    if (input.amount > outstanding) {
      throw Errors.badRequest("SETTLEMENT_EXCEEDS_BALANCE", `Summa haydovchi qarzidan (${outstanding} so‘m) oshib ketdi.`, { outstanding });
    }
    const settlement = await tx.settlement.create({
      data: {
        driverId: input.driverId,
        amount: input.amount,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedById: staff.userId,
      },
    });
    const transactionId = randomUUID();
    await tx.ledgerEntry.createMany({
      data: [
        { transactionId, eventType: "COMMISSION_SETTLED", account: "PLATFORM_CASH", direction: "DEBIT", amount: input.amount, driverId: input.driverId, settlementId: settlement.id, createdById: staff.userId, memo: "Komissiya to‘lovi" },
        { transactionId, eventType: "COMMISSION_SETTLED", account: "DRIVER_COMMISSION_RECEIVABLE", direction: "CREDIT", amount: input.amount, driverId: input.driverId, settlementId: settlement.id, createdById: staff.userId, memo: "Komissiya to‘lovi" },
      ],
    });
    await audit(
      { actorId: staff.userId, action: "settlement.record", entityType: "settlement", entityId: settlement.id, after: settlement, ip: staff.ip, userAgent: staff.userAgent },
      tx,
    );
    return { settlement, outstandingAfter: outstanding - input.amount };
  });
}

export interface FinanceSummary {
  settledRides: number;
  grossFares: number;
  commissionAccrued: number;
  settlementsReceived: number;
  outstandingReceivable: number;
}

export async function financeSummary(range: { from: Date; to: Date; cityId?: string | null }): Promise<FinanceSummary> {
  const city = range.cityId ?? null;
  const [rides] = await db().$queryRaw<{ n: bigint; gross: bigint | null }[]>`
    SELECT COUNT(*)::bigint AS n, SUM(final_fare)::bigint AS gross FROM rides
     WHERE status = 'SETTLED' AND settled_at >= ${range.from} AND settled_at < ${range.to}
       AND (${city}::uuid IS NULL OR city_id = ${city}::uuid)`;
  const [ledger] = await db().$queryRaw<{ accrued: bigint | null; settled: bigint | null }[]>`
    SELECT
      SUM(CASE WHEN le.event_type = 'COMMISSION_ACCRUED' AND le.account = 'PLATFORM_COMMISSION_REVENUE' THEN le.amount ELSE 0 END)::bigint AS accrued,
      SUM(CASE WHEN le.event_type = 'COMMISSION_SETTLED' AND le.account = 'PLATFORM_CASH' THEN le.amount ELSE 0 END)::bigint AS settled
      FROM ledger_entries le
      LEFT JOIN driver_profiles dp ON dp.user_id = le.driver_id
     WHERE le.created_at >= ${range.from} AND le.created_at < ${range.to}
       AND (${city}::uuid IS NULL OR dp.city_id = ${city}::uuid)`;
  const [out] = await db().$queryRaw<{ balance: bigint | null }[]>`
    SELECT SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END)::bigint AS balance
      FROM ledger_entries le
      LEFT JOIN driver_profiles dp ON dp.user_id = le.driver_id
     WHERE le.account = 'DRIVER_COMMISSION_RECEIVABLE'
       AND (${city}::uuid IS NULL OR dp.city_id = ${city}::uuid)`;
  return {
    settledRides: Number(rides?.n ?? 0),
    grossFares: Number(rides?.gross ?? 0),
    commissionAccrued: Number(ledger?.accrued ?? 0),
    settlementsReceived: Number(ledger?.settled ?? 0),
    outstandingReceivable: Number(out?.balance ?? 0),
  };
}

export async function driverBalances(limit = 200) {
  return db().$queryRaw<{ driver_id: string; full_name: string | null; phone: string; outstanding: bigint; accrued: bigint; settled: bigint }[]>`
    SELECT u.id::text AS driver_id, u.full_name, u.phone,
           COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END), 0)::bigint AS outstanding,
           COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE 0 END), 0)::bigint AS accrued,
           COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE 0 END), 0)::bigint AS settled
      FROM ledger_entries le
      JOIN users u ON u.id = le.driver_id
     WHERE le.account = 'DRIVER_COMMISSION_RECEIVABLE'
     GROUP BY u.id
     ORDER BY outstanding DESC
     LIMIT ${limit}`;
}

export interface ReconciliationIssue {
  kind: string;
  rideId?: string;
  detail: string;
}

/** Cross-checks rides, payments and ledger. An empty list means the books agree. */
export async function reconcile(): Promise<ReconciliationIssue[]> {
  const issues: ReconciliationIssue[] = [];
  const [global] = await db().$queryRaw<{ debit: bigint | null; credit: bigint | null }[]>`
    SELECT SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END)::bigint AS debit,
           SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END)::bigint AS credit FROM ledger_entries`;
  if (Number(global?.debit ?? 0) !== Number(global?.credit ?? 0)) {
    issues.push({ kind: "LEDGER_UNBALANCED", detail: `Debit ${global?.debit} ≠ credit ${global?.credit}` });
  }
  const missing = await db().$queryRaw<{ id: string; code: string; commission_amount: number; accrued: bigint | null }[]>`
    SELECT r.id::text, r.code, r.commission_amount,
           (SELECT SUM(le.amount) FROM ledger_entries le WHERE le.ride_id = r.id AND le.event_type = 'COMMISSION_ACCRUED' AND le.account = 'DRIVER_COMMISSION_RECEIVABLE')::bigint AS accrued
      FROM rides r
     WHERE r.status = 'SETTLED' AND COALESCE(r.commission_amount, 0) > 0`;
  for (const r of missing) {
    if (Number(r.accrued ?? 0) !== r.commission_amount) {
      issues.push({ kind: "COMMISSION_MISMATCH", rideId: r.id, detail: `${r.code}: ride commission ${r.commission_amount}, ledger ${r.accrued ?? 0}` });
    }
  }
  const payments = await db().$queryRaw<{ ride_id: string; status: string; ride_status: string; amount: number; final_fare: number | null }[]>`
    SELECT p.ride_id::text, p.status::text, r.status::text AS ride_status, p.amount, r.final_fare
      FROM payments p JOIN rides r ON r.id = p.ride_id
     WHERE (p.status = 'COLLECTED_BY_DRIVER' AND r.status <> 'SETTLED')
        OR (r.status = 'SETTLED' AND p.status <> 'COLLECTED_BY_DRIVER')
        OR (r.final_fare IS NOT NULL AND p.amount <> r.final_fare)`;
  for (const p of payments) {
    issues.push({ kind: "PAYMENT_MISMATCH", rideId: p.ride_id, detail: `payment ${p.status}/${p.amount} vs ride ${p.ride_status}/${p.final_fare}` });
  }
  return issues;
}
