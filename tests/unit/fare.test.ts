import { describe, expect, it } from "vitest";
import { calculateCommission, calculateFare, divRound, roundUpToStep } from "@/features/pricing/fare";

const T = { baseFare: 5000, perKm: 1500, perMinute: 200, minimumFare: 8000, roundingStep: 500, commissionBps: 1000 };

describe("fare calculation", () => {
  it("computes base + distance + duration and rounds up to the step", () => {
    // 4.2 km, 9.5 min → 5000 + 6300 + 1900 = 13200 → 13500
    const f = calculateFare(T, 4200, 570);
    expect(f.distanceFare).toBe(6300);
    expect(f.timeFare).toBe(1900);
    expect(f.subtotal).toBe(13200);
    expect(f.totalFare).toBe(13500);
    expect(f.minimumApplied).toBe(false);
  });

  it("applies the minimum fare", () => {
    const f = calculateFare(T, 500, 60);
    expect(f.subtotal).toBe(5000 + 750 + 200);
    expect(f.minimumApplied).toBe(true);
    expect(f.totalFare).toBe(8000);
  });

  it("keeps exact multiples of the rounding step", () => {
    expect(calculateFare({ ...T, minimumFare: 0 }, 2000, 0).totalFare).toBe(8000);
  });

  it("uses integer arithmetic only (no float drift)", () => {
    const f = calculateFare({ ...T, perKm: 1333, perMinute: 177, roundingStep: 1 }, 3333, 77);
    expect(Number.isInteger(f.distanceFare) && Number.isInteger(f.timeFare) && Number.isInteger(f.totalFare)).toBe(true);
    expect(f.distanceFare).toBe(divRound(1333 * 3333, 1000));
  });

  it("rejects negative or fractional inputs", () => {
    expect(() => calculateFare(T, -1, 10)).toThrow();
    expect(() => calculateFare(T, 10.5, 10)).toThrow();
    expect(() => calculateFare({ ...T, roundingStep: 0 }, 1000, 60)).toThrow();
  });

  it("rounds up to step", () => {
    expect(roundUpToStep(13001, 500)).toBe(13500);
    expect(roundUpToStep(13000, 500)).toBe(13000);
  });
});

describe("commission", () => {
  it("splits 10% commission", () => {
    expect(calculateCommission(13500, 1000)).toEqual({ fare: 13500, commissionBps: 1000, commission: 1350, driverEarnings: 12150 });
  });
  it("rounds half up and keeps fare = commission + earnings", () => {
    const c = calculateCommission(12345, 1250); // 1543.125 → 1543
    expect(c.commission).toBe(1543);
    expect(c.commission + c.driverEarnings).toBe(12345);
    expect(calculateCommission(1005, 1000).commission).toBe(101); // 100.5 → 101
  });
  it("handles zero commission and validates range", () => {
    expect(calculateCommission(10000, 0).driverEarnings).toBe(10000);
    expect(() => calculateCommission(10000, 10001)).toThrow();
  });
});
