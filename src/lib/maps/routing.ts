import { env } from "@/lib/env";
import { Errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { haversineMeters, type GeoJsonLineString, type LatLng } from "@/lib/maps/geo";

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJsonLineString | null;
  provider: string;
  /** True when the figures are a straight-line estimate rather than a road route. */
  estimated: boolean;
}

export interface RoutingProvider {
  readonly name: string;
  route(from: LatLng, to: LatLng): Promise<RouteResult>;
  /** Driving durations (seconds) from each origin to one destination, same order as origins. */
  durationsTo(origins: LatLng[], destination: LatLng): Promise<number[]>;
}

/**
 * Straight-line estimator for development and as an explicit, opt-in fallback.
 * Assumptions: road detour factor 1.35, average urban speed 28 km/h. Not a road route.
 */
export class EstimatedRoutingProvider implements RoutingProvider {
  readonly name = "estimate";
  constructor(
    private readonly detour = 1.35,
    private readonly speedKmh = 28,
  ) {}

  private estimate(a: LatLng, b: LatLng) {
    const distance = Math.round(haversineMeters(a, b) * this.detour);
    const duration = Math.round((distance / 1000 / this.speedKmh) * 3600) + 60; // +1 min pickup/parking overhead
    return { distance, duration };
  }

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const { distance, duration } = this.estimate(from, to);
    return {
      distanceMeters: distance,
      durationSeconds: duration,
      geometry: { type: "LineString", coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
      provider: this.name,
      estimated: true,
    };
  }

  async durationsTo(origins: LatLng[], destination: LatLng) {
    return origins.map((o) => this.estimate(o, destination).duration);
  }
}

/**
 * OSRM HTTP API adapter (route + table services). Point OSRM_URL at a self-hosted OSRM built
 * from an OpenStreetMap extract of Uzbekistan. The public demo server must not be used commercially.
 */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = "osrm";
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body = (await res.json()) as T & { code?: string };
    if (body.code && body.code !== "Ok") throw new Error(`OSRM code ${body.code}`);
    return body;
  }

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    try {
      const body = await this.get<{ routes: { distance: number; duration: number; geometry: GeoJsonLineString }[] }>(
        `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`,
      );
      const r = body.routes[0];
      if (!r) throw Errors.badRequest("NO_ROUTE", "Ushbu manzillar orasida yo‘l topilmadi.");
      return { distanceMeters: Math.round(r.distance), durationSeconds: Math.round(r.duration), geometry: r.geometry, provider: this.name, estimated: false };
    } catch (err) {
      if ((err as { code?: string }).code === "NO_ROUTE") throw err;
      logger.error("OSRM route failed", { err });
      throw Errors.unavailable("ROUTING_UNAVAILABLE", "Marshrut xizmati vaqtincha ishlamayapti.");
    }
  }

  async durationsTo(origins: LatLng[], destination: LatLng): Promise<number[]> {
    if (origins.length === 0) return [];
    const coords = [...origins, destination].map((p) => `${p.lng},${p.lat}`).join(";");
    const sources = origins.map((_, i) => i).join(";");
    try {
      const body = await this.get<{ durations: (number | null)[][] }>(
        `/table/v1/driving/${coords}?sources=${sources}&destinations=${origins.length}&annotations=duration`,
      );
      return origins.map((_, i) => Math.round(body.durations[i]?.[0] ?? Number.POSITIVE_INFINITY));
    } catch (err) {
      logger.warn("OSRM table failed; using straight-line estimate for ranking", { err });
      return new EstimatedRoutingProvider().durationsTo(origins, destination);
    }
  }
}

let provider: RoutingProvider | null = null;

export function getRoutingProvider(): RoutingProvider {
  if (provider) return provider;
  const e = env();
  provider = e.ROUTING_PROVIDER === "osrm" && e.OSRM_URL ? new OsrmRoutingProvider(e.OSRM_URL) : new EstimatedRoutingProvider();
  return provider;
}

export function setRoutingProviderForTests(p: RoutingProvider | null) {
  provider = p;
}
