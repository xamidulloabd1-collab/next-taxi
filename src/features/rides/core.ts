import { randomBytes } from "node:crypto";
import type { ActorType, Prisma, Ride, RideStatus } from "@prisma/client";
import type { Tx } from "@/lib/db/prisma";
import { Errors, AppError } from "@/lib/errors";
import { publish, STAFF_AUDIENCE } from "@/lib/realtime/events";
import { assertTransition } from "@/features/rides/state-machine";

export interface Actor {
  type: ActorType;
  id?: string | null;
}

/** Locks the ride row (SELECT … FOR UPDATE) and returns its current state. */
export async function lockRide(tx: Tx, rideId: string): Promise<Ride> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM rides WHERE id = ${rideId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw Errors.notFound("Buyurtma");
  return tx.ride.findUniqueOrThrow({ where: { id: rideId } });
}

/**
 * Applies a validated status transition: checks the state machine, updates with an
 * optimistic version guard, and appends to ride_status_events. Caller must hold the row lock.
 */
export async function applyTransition(
  tx: Tx,
  ride: Ride,
  to: RideStatus,
  actor: Actor,
  data: Prisma.RideUncheckedUpdateManyInput = {},
  opts: { reason?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<Ride> {
  assertTransition(ride.status, to, actor.type);
  const res = await tx.ride.updateMany({
    where: { id: ride.id, status: ride.status, version: ride.version },
    data: { ...data, status: to, version: { increment: 1 } },
  });
  if (res.count !== 1) throw new AppError("RIDE_STATE_CHANGED", 409, "Buyurtma holati o‘zgardi. Sahifani yangilang.");
  await tx.rideStatusEvent.create({
    data: {
      rideId: ride.id,
      fromStatus: ride.status,
      toStatus: to,
      actorType: actor.type,
      actorId: actor.id ?? null,
      reason: opts.reason ?? null,
      metadata: (opts.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
  return tx.ride.findUniqueOrThrow({ where: { id: ride.id } });
}

/** Notifies the ride's participants and staff (delivered on commit). */
export async function notifyRide(tx: Tx, ride: Pick<Ride, "id" | "passengerId" | "driverId" | "status">, extraAudience: string[] = []) {
  const audience = [ride.passengerId, STAFF_AUDIENCE, ...extraAudience];
  if (ride.driverId) audience.push(ride.driverId);
  await publish(tx, { type: "ride.updated", audience: [...new Set(audience)], rideId: ride.id, status: ride.status });
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateRideCode(): string {
  const bytes = randomBytes(6);
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `NT-${s}`;
}
