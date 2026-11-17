import { describe, expect, it } from "vitest";
import type { RideStatus } from "@prisma/client";
import { RIDE_TRANSITIONS, assertTransition, canTransition, TERMINAL_STATUSES } from "@/features/rides/state-machine";

describe("ride state machine", () => {
  it("allows the happy path with the correct actors", () => {
    const path: [RideStatus, RideStatus, "SYSTEM" | "DRIVER"][] = [
      ["REQUESTED", "SEARCHING", "SYSTEM"],
      ["SEARCHING", "ASSIGNED", "DRIVER"],
      ["ASSIGNED", "ARRIVING", "DRIVER"],
      ["ARRIVING", "ARRIVED", "DRIVER"],
      ["ARRIVED", "IN_PROGRESS", "DRIVER"],
      ["IN_PROGRESS", "COMPLETED", "DRIVER"],
      ["COMPLETED", "SETTLED", "DRIVER"],
    ];
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor)).toBe(true);
  });

  it("rejects skipping states", () => {
    expect(canTransition("SEARCHING", "IN_PROGRESS", "DRIVER")).toBe(false);
    expect(canTransition("ASSIGNED", "COMPLETED", "DRIVER")).toBe(false);
    expect(canTransition("REQUESTED", "ASSIGNED", "DRIVER")).toBe(false);
  });

  it("enforces actor permissions", () => {
    expect(canTransition("SEARCHING", "ASSIGNED", "PASSENGER")).toBe(false);
    expect(canTransition("IN_PROGRESS", "CANCELLED", "PASSENGER")).toBe(false);
    expect(canTransition("IN_PROGRESS", "CANCELLED", "DRIVER")).toBe(false);
    expect(canTransition("IN_PROGRESS", "CANCELLED", "ADMIN")).toBe(true);
    expect(canTransition("SEARCHING", "NO_DRIVER", "PASSENGER")).toBe(false);
  });

  it("has no transitions out of terminal states", () => {
    for (const s of TERMINAL_STATUSES) expect(RIDE_TRANSITIONS[s]).toHaveLength(0);
  });

  it("supports driver withdrawal back to searching before the trip starts", () => {
    expect(canTransition("ASSIGNED", "SEARCHING", "DRIVER")).toBe(true);
    expect(canTransition("IN_PROGRESS", "SEARCHING", "DRIVER")).toBe(false);
  });

  it("assertTransition throws a 409 AppError", () => {
    expect(() => assertTransition("SETTLED", "CANCELLED", "ADMIN")).toThrowError(/holatini/);
  });
});
