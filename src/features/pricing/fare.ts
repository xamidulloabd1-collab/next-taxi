/**
 * Pure fare arithmetic. All amounts are integer UZS; no floating-point money.
 * Fare = Base + Distance cost + Duration cost, raised to the minimum fare,
 * then rounded UP to the tariff's rounding step.
 */
export interface TariffParams {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  roundingStep: number;
  commissionBps: number;
}

export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  subtotal: number;
  minimumApplied: boolean;
  totalFare: number;
}

function assertNonNegInt(name: string, v: number) {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

/** Integer division rounding half up: round(a / b) for non-negative integers. */
export function divRound(a: number, b: number): number {
  return Math.floor((a * 2 + b) / (2 * b));
}

export function roundUpToStep(amount: number, step: number): number {
  if (step <= 0) throw new RangeError("roundingStep must be positive");
  return Math.ceil(amount / step) * step;
}

export function calculateFare(t: TariffParams, distanceMeters: number, durationSeconds: number): FareBreakdown {
  const inputs = { baseFare: t.baseFare, perKm: t.perKm, perMinute: t.perMinute, minimumFare: t.minimumFare, roundingStep: t.roundingStep, distanceMeters, durationSeconds };
  for (const [k, v] of Object.entries(inputs)) assertNonNegInt(k, v);
  const distanceFare = divRound(t.perKm * distanceMeters, 1000);
  const timeFare = divRound(t.perMinute * durationSeconds, 60);
  const subtotal = t.baseFare + distanceFare + timeFare;
  const minimumApplied = subtotal < t.minimumFare;
  const totalFare = roundUpToStep(Math.max(subtotal, t.minimumFare), t.roundingStep);
  return { baseFare: t.baseFare, distanceFare, timeFare, subtotal, minimumApplied, totalFare };
}

export interface CommissionSplit {
  fare: number;
  commissionBps: number;
  commission: number;
  driverEarnings: number;
}

/** Platform commission (basis points, 1000 = 10%) rounded half up; driver keeps the rest. */
export function calculateCommission(fare: number, commissionBps: number): CommissionSplit {
  assertNonNegInt("fare", fare);
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) throw new RangeError("commissionBps out of range");
  const commission = divRound(fare * commissionBps, 10_000);
  return { fare, commissionBps, commission, driverEarnings: fare - commission };
}

export function formatUzs(amount: number): string {
  return `${amount.toLocaleString("uz-UZ").replace(/,/g, " ").replace(/ /g, " ")} so‘m`;
}
