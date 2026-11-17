export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

const R = 6_371_008.8; // mean Earth radius (m)

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

/** Validates a GeoJSON Polygon (closed rings, ≥4 positions, valid coordinates). */
export function validatePolygon(input: unknown): GeoJsonPolygon | null {
  const p = input as GeoJsonPolygon;
  if (!p || p.type !== "Polygon" || !Array.isArray(p.coordinates) || p.coordinates.length < 1) return null;
  for (const ring of p.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4) return null;
    for (const pos of ring) {
      if (!Array.isArray(pos) || pos.length < 2 || !isValidLatLng({ lng: pos[0], lat: pos[1] })) return null;
    }
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) return null;
  }
  return { type: "Polygon", coordinates: p.coordinates.map((r) => r.map((pos) => [pos[0]!, pos[1]!] as [number, number])) };
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} daq`;
  return `${Math.floor(min / 60)} soat ${min % 60} daq`;
}
