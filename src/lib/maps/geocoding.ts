import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { LatLng } from "@/lib/maps/geo";

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

export interface GeocodingProvider {
  readonly name: string;
  search(query: string, near: LatLng | null, limit?: number): Promise<Place[]>;
  reverse(point: LatLng): Promise<string | null>;
}

/** No geocoder configured: users pick points on the map; labels fall back to coordinates. */
export class NoGeocodingProvider implements GeocodingProvider {
  readonly name = "none";
  async search() {
    return [];
  }
  async reverse() {
    return null;
  }
}

/**
 * Nominatim-compatible adapter (Nominatim or a Photon/Nominatim-compatible proxy).
 * The public nominatim.openstreetmap.org service allows max 1 request/second and
 * forbids heavy/commercial bulk use — self-host or use a commercial provider in production.
 */
export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly name = "nominatim";
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
  ) {}

  private async get(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      headers: { "user-agent": this.userAgent, "accept-language": "uz,ru,en" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    return res.json();
  }

  async search(query: string, near: LatLng | null, limit = 6): Promise<Place[]> {
    const params = new URLSearchParams({ q: query, format: "jsonv2", limit: String(limit), countrycodes: "uz" });
    if (near) {
      const d = 0.15; // ~15 km box around the city centre
      params.set("viewbox", `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
      params.set("bounded", "1");
    }
    try {
      const rows = (await this.get(`/search?${params}`)) as { display_name: string; lat: string; lon: string }[];
      return rows.map((r) => ({ label: r.display_name.split(",").slice(0, 3).join(","), lat: Number(r.lat), lng: Number(r.lon) }));
    } catch (err) {
      logger.warn("Geocoding search failed", { err });
      return [];
    }
  }

  async reverse(point: LatLng): Promise<string | null> {
    const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lng), format: "jsonv2", zoom: "17" });
    try {
      const r = (await this.get(`/reverse?${params}`)) as { display_name?: string };
      return r.display_name ? r.display_name.split(",").slice(0, 2).join(",") : null;
    } catch (err) {
      logger.warn("Reverse geocoding failed", { err });
      return null;
    }
  }
}

let provider: GeocodingProvider | null = null;
export function getGeocodingProvider(): GeocodingProvider {
  if (provider) return provider;
  const e = env();
  provider =
    e.GEOCODING_PROVIDER === "nominatim" && e.GEOCODING_URL
      ? new NominatimGeocodingProvider(e.GEOCODING_URL, e.GEOCODING_USER_AGENT)
      : new NoGeocodingProvider();
  return provider;
}

export function coordinateLabel(p: LatLng) {
  return `Xaritadagi nuqta (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;
}
