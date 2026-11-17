import type { City } from "@prisma/client";
import { db, type Db } from "@/lib/db/prisma";
import { Errors } from "@/lib/errors";
import type { LatLng } from "@/lib/maps/geo";
import { isWithinOperatingHours } from "@/lib/time";

export interface ZoneMatch {
  zoneId: string;
  cityId: string;
}

/** Finds the active service zone (in an active city) containing the point, using PostGIS. */
export async function findServiceZone(point: LatLng, client: Db = db()): Promise<ZoneMatch | null> {
  const rows = await client.$queryRaw<{ zone_id: string; city_id: string }[]>`
    SELECT z.id::text AS zone_id, z.city_id::text AS city_id
      FROM service_zones z
      JOIN cities c ON c.id = z.city_id
     WHERE z.is_active AND c.status = 'ACTIVE'
       AND ST_Covers(z.area, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326))
     ORDER BY ST_Area(z.area) ASC
     LIMIT 1`;
  const r = rows[0];
  return r ? { zoneId: r.zone_id, cityId: r.city_id } : null;
}

export async function isPointInCityZones(cityId: string, point: LatLng, client: Db = db()): Promise<boolean> {
  const rows = await client.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM service_zones z
       WHERE z.city_id = ${cityId}::uuid AND z.is_active
         AND ST_Covers(z.area, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326))
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

export function assertCityOperating(city: Pick<City, "status" | "operatingHoursStart" | "operatingHoursEnd" | "timezone" | "name">, now = new Date()) {
  if (city.status !== "ACTIVE") throw Errors.unavailable("CITY_INACTIVE", `${city.name} shahrida xizmat hali ishga tushmagan.`);
  if (!isWithinOperatingHours(now, city.operatingHoursStart, city.operatingHoursEnd, city.timezone)) {
    throw Errors.unavailable(
      "OUTSIDE_OPERATING_HOURS",
      `Xizmat ${city.operatingHoursStart} dan ${city.operatingHoursEnd} gacha ishlaydi. Hozir buyurtma qabul qilinmaydi.`,
    );
  }
}

/**
 * Resolves pickup/dropoff to a city and validates eligibility:
 * pickup inside an active zone; dropoff inside the same city's zones (pilot policy); city operating now.
 */
export async function resolveTripEligibility(pickup: LatLng, dropoff: LatLng, client: Db = db()) {
  const zone = await findServiceZone(pickup, client);
  if (!zone) throw Errors.badRequest("PICKUP_OUT_OF_AREA", "Olib ketish manzili xizmat hududidan tashqarida.");
  const city = await client.city.findUniqueOrThrow({ where: { id: zone.cityId } });
  assertCityOperating(city);
  if (!(await isPointInCityZones(city.id, dropoff, client))) {
    throw Errors.badRequest("DROPOFF_OUT_OF_AREA", "Borish manzili xizmat hududidan tashqarida.");
  }
  return { city, zoneId: zone.zoneId };
}
