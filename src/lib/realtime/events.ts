import type { Db } from "@/lib/db/prisma";

export const REALTIME_CHANNEL = "nt_events";
/** Audience token delivered to every connected staff (admin) session. */
export const STAFF_AUDIENCE = "staff";

export type RealtimeEventType =
  | "ride.updated"
  | "ride.offer"
  | "ride.offer.closed"
  | "driver.location"
  | "driver.status"
  | "incident.created"
  | "support.updated";

export interface RealtimeEvent {
  type: RealtimeEventType;
  /** User IDs (or STAFF_AUDIENCE) allowed to receive the event. Computed server-side only. */
  audience: string[];
  rideId?: string;
  status?: string;
  data?: Record<string, unknown>;
  at: string;
}

/**
 * Publishes an event with PostgreSQL NOTIFY. When called with a transaction client the
 * notification is delivered only if the transaction commits — clients never see events
 * for state that was rolled back.
 */
export async function publish(client: Db, event: Omit<RealtimeEvent, "at">) {
  const payload = JSON.stringify({ ...event, at: new Date().toISOString() });
  if (payload.length > 7500) throw new Error("Realtime payload too large");
  await client.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`;
}
