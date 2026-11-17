/** Client-side shapes of API responses (mirrors server DTOs). */
export type RideStatus = "REQUESTED" | "SEARCHING" | "ASSIGNED" | "ARRIVING" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "SETTLED" | "CANCELLED" | "NO_DRIVER";

export interface Place {
  lat: number;
  lng: number;
  address: string | null;
}

export interface LineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RideBase {
  id: string;
  code: string;
  status: RideStatus;
  statusLabel: string;
  cityName: string;
  vehicleClass: "ECONOMY" | "COMFORT";
  pickup: Place;
  dropoff: Place;
  distanceMeters: number;
  durationSeconds: number;
  routeGeometry: LineString | null;
  routeEstimated: boolean;
  quotedFare: number;
  finalFare: number | null;
  paymentMethod: "CASH";
  paymentStatus: string | null;
  note: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  timestamps: Record<"requestedAt" | "assignedAt" | "arrivedAt" | "startedAt" | "completedAt" | "settledAt" | "cancelledAt", string | null>;
}

export interface PassengerRide extends RideBase {
  driver: { name: string; rating: number | null; phone: string | null; location: { lat: number; lng: number; heading: number | null; recordedAt: string } | null } | null;
  vehicle: { make: string; model: string; color: string; plateNumber: string } | null;
  myRating: { score: number; comment: string | null } | null;
}

export interface DriverRide extends RideBase {
  passenger: { name: string; phone: string | null; rating: number | null };
  commissionAmount: number | null;
  driverEarnings: number | null;
  myRating: { score: number } | null;
}

export interface Quote {
  id: string;
  vehicleClass: "ECONOMY" | "COMFORT";
  vehicleClassLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  routeEstimated: boolean;
  routeGeometry: LineString | null;
  totalFare: number;
  expiresAt: string;
}

export interface CitiesResponse {
  cities: {
    id: string;
    name: string;
    center: { lat: number; lng: number } | null;
    zoom: number;
    operatingHours: { start: string; end: string };
    zones: { id: string; name: string; boundary: { type: "Polygon"; coordinates: [number, number][][] } }[];
  }[];
  features: { geocoding: boolean; routingEstimated: boolean };
  supportPhone: string;
  cancelReasons: string[];
  allCities: { id: string; name: string; region: string; status: string }[];
}

export function placeLabel(p: Place | null | undefined, fallback = "Belgilangan nuqta") {
  if (!p) return fallback;
  return p.address ?? `${fallback} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

export function fmtDistance(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

export function fmtMinutes(s: number) {
  return `${Math.max(1, Math.round(s / 60))} daq`;
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const DEFAULT_CENTER = { lat: 38.62083, lng: 66.24806 };

export function statusTone(s: string): "success" | "warn" | "danger" | "neutral" {
  if (s === "SETTLED" || s === "COMPLETED") return "success";
  if (s === "CANCELLED" || s === "NO_DRIVER") return "danger";
  return "warn";
}
