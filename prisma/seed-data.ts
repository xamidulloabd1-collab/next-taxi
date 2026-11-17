/**
 * Reference data for seeding.
 *
 * G‘uzor centre: 38.62083 N, 66.24806 E — Wikipedia "Gʻuzor" infobox coordinates.
 * The pilot zone below is a GEOMETRIC PLACEHOLDER (a ~3.5 km radius polygon around that centre),
 * NOT a surveyed city boundary. Replace it in Admin → Shaharlar → G‘uzor with a boundary traced
 * from properly licensed data (e.g. OpenStreetMap, ODbL) or official cadastral data before launch.
 *
 * Other cities are created INACTIVE without coordinates; an administrator must configure the
 * centre, a service zone and a tariff before activation (enforced server-side).
 */
export const GUZOR = {
  slug: "guzor",
  name: "G‘uzor",
  nameRu: "Гузар",
  nameEn: "Guzar",
  region: "Qashqadaryo viloyati",
  centerLat: 38.62083,
  centerLng: 66.24806,
  defaultZoom: 13.5,
};

export const PLACEHOLDER_ZONE_RADIUS_M = 3500;

/** Regular polygon approximating a circle (GeoJSON [lng, lat] order, closed ring). */
export function circlePolygon(lat: number, lng: number, radiusM: number, sides = 24) {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    coords.push([Number((lng + dLng * Math.cos(a)).toFixed(6)), Number((lat + dLat * Math.sin(a)).toFixed(6))]);
  }
  coords.push(coords[0]!);
  return { type: "Polygon" as const, coordinates: [coords] };
}

/** Example tariffs — configurable starting points, NOT a statement of market prices. */
export const EXAMPLE_TARIFFS = [
  { vehicleClass: "ECONOMY" as const, name: "Ekonom (namuna)", baseFare: 5000, perKm: 1500, perMinute: 200, minimumFare: 8000, roundingStep: 500, commissionBps: 1000, quoteTtlSeconds: 300 },
  { vehicleClass: "COMFORT" as const, name: "Komfort (namuna)", baseFare: 7000, perKm: 2000, perMinute: 300, minimumFare: 12000, roundingStep: 500, commissionBps: 1200, quoteTtlSeconds: 300 },
];

/** Cities supported by the data model but inactive until configured. */
export const INACTIVE_CITIES: { slug: string; name: string; nameRu: string; region: string }[] = [
  { slug: "qarshi", name: "Qarshi", nameRu: "Карши", region: "Qashqadaryo viloyati" },
  { slug: "shahrisabz", name: "Shahrisabz", nameRu: "Шахрисабз", region: "Qashqadaryo viloyati" },
  { slug: "kitob", name: "Kitob", nameRu: "Китаб", region: "Qashqadaryo viloyati" },
  { slug: "toshkent", name: "Toshkent", nameRu: "Ташкент", region: "Toshkent shahri" },
  { slug: "samarqand", name: "Samarqand", nameRu: "Самарканд", region: "Samarqand viloyati" },
  { slug: "buxoro", name: "Buxoro", nameRu: "Бухара", region: "Buxoro viloyati" },
  { slug: "navoiy", name: "Navoiy", nameRu: "Навои", region: "Navoiy viloyati" },
  { slug: "jizzax", name: "Jizzax", nameRu: "Джизак", region: "Jizzax viloyati" },
  { slug: "guliston", name: "Guliston", nameRu: "Гулистан", region: "Sirdaryo viloyati" },
  { slug: "termiz", name: "Termiz", nameRu: "Термез", region: "Surxondaryo viloyati" },
  { slug: "nukus", name: "Nukus", nameRu: "Нукус", region: "Qoraqalpog‘iston Respublikasi" },
  { slug: "urganch", name: "Urganch", nameRu: "Ургенч", region: "Xorazm viloyati" },
  { slug: "andijon", name: "Andijon", nameRu: "Андижан", region: "Andijon viloyati" },
  { slug: "fargona", name: "Farg‘ona", nameRu: "Фергана", region: "Farg‘ona viloyati" },
  { slug: "namangan", name: "Namangan", nameRu: "Наманган", region: "Namangan viloyati" },
  { slug: "nurafshon", name: "Nurafshon", nameRu: "Нурафшан", region: "Toshkent viloyati" },
];
