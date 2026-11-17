import type { ActorType, RideStatus } from "@prisma/client";
import { AppError } from "@/lib/errors";

/** Ride is "open" for the passenger (blocks a second booking). */
export const PASSENGER_ACTIVE_STATUSES: RideStatus[] = ["REQUESTED", "SEARCHING", "ASSIGNED", "ARRIVING", "ARRIVED", "IN_PROGRESS"];
/** Driver is busy with the ride. */
export const DRIVER_ACTIVE_STATUSES: RideStatus[] = ["ASSIGNED", "ARRIVING", "ARRIVED", "IN_PROGRESS"];
/** Statuses in which the passenger may see the driver's live location and contact. */
export const LIVE_TRACKING_STATUSES: RideStatus[] = ["ASSIGNED", "ARRIVING", "ARRIVED", "IN_PROGRESS"];
export const TERMINAL_STATUSES: RideStatus[] = ["SETTLED", "CANCELLED", "NO_DRIVER"];

interface Rule {
  to: RideStatus;
  actors: readonly ActorType[];
}

/**
 * Formal ride lifecycle. Every status change goes through `assertTransition`, is applied with
 * an optimistic version check under a row lock, and is recorded in ride_status_events.
 * SEARCHING after ASSIGNED/ARRIVING/ARRIVED = driver withdrew; the ride is re-dispatched.
 */
export const RIDE_TRANSITIONS: Record<RideStatus, readonly Rule[]> = {
  REQUESTED: [
    { to: "SEARCHING", actors: ["SYSTEM"] },
    { to: "CANCELLED", actors: ["PASSENGER", "SYSTEM", "ADMIN"] },
  ],
  SEARCHING: [
    { to: "ASSIGNED", actors: ["DRIVER"] },
    { to: "NO_DRIVER", actors: ["SYSTEM"] },
    { to: "CANCELLED", actors: ["PASSENGER", "SYSTEM", "ADMIN"] },
  ],
  ASSIGNED: [
    { to: "ARRIVING", actors: ["DRIVER"] },
    { to: "ARRIVED", actors: ["DRIVER"] },
    { to: "SEARCHING", actors: ["DRIVER", "SYSTEM", "ADMIN"] },
    { to: "CANCELLED", actors: ["PASSENGER", "ADMIN"] },
  ],
  ARRIVING: [
    { to: "ARRIVED", actors: ["DRIVER"] },
    { to: "SEARCHING", actors: ["DRIVER", "SYSTEM", "ADMIN"] },
    { to: "CANCELLED", actors: ["PASSENGER", "ADMIN"] },
  ],
  ARRIVED: [
    { to: "IN_PROGRESS", actors: ["DRIVER"] },
    { to: "SEARCHING", actors: ["DRIVER", "ADMIN"] },
    { to: "CANCELLED", actors: ["PASSENGER", "DRIVER", "ADMIN"] },
  ],
  IN_PROGRESS: [
    { to: "COMPLETED", actors: ["DRIVER", "ADMIN"] },
    { to: "CANCELLED", actors: ["ADMIN"] },
  ],
  COMPLETED: [{ to: "SETTLED", actors: ["DRIVER", "ADMIN"] }],
  SETTLED: [],
  CANCELLED: [],
  NO_DRIVER: [],
};

export function canTransition(from: RideStatus, to: RideStatus, actor: ActorType): boolean {
  return RIDE_TRANSITIONS[from].some((r) => r.to === to && r.actors.includes(actor));
}

export function assertTransition(from: RideStatus, to: RideStatus, actor: ActorType) {
  if (!canTransition(from, to, actor)) {
    throw new AppError("INVALID_TRANSITION", 409, "Buyurtma holatini bu tarzda o‘zgartirib bo‘lmaydi.", { from, to, actor });
  }
}

export const RIDE_STATUS_LABELS: Record<RideStatus, string> = {
  REQUESTED: "So‘rov yuborildi",
  SEARCHING: "Haydovchi qidirilmoqda",
  ASSIGNED: "Haydovchi topildi",
  ARRIVING: "Haydovchi yo‘lda",
  ARRIVED: "Haydovchi yetib keldi",
  IN_PROGRESS: "Safarda",
  COMPLETED: "Safar yakunlandi",
  SETTLED: "To‘lov qabul qilindi",
  CANCELLED: "Bekor qilindi",
  NO_DRIVER: "Haydovchi topilmadi",
};
