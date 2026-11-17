/**
 * Baseline seed (safe for production): cities, the G‘uzor pilot configuration (INACTIVE until an
 * administrator verifies the zone), example tariffs and the first SUPER_ADMIN.
 * Idempotent: re-running does not duplicate data.
 *
 *   SEED_ADMIN_PHONE=+998XXXXXXXXX npm run db:seed
 */
import "../scripts/load-env";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { EXAMPLE_TARIFFS, GUZOR, INACTIVE_CITIES, PLACEHOLDER_ZONE_RADIUS_M, circlePolygon } from "./seed-data";

export async function seedBaseline(prisma: PrismaClient, adminPhone: string | null) {
  const guzor = await prisma.city.upsert({
    where: { slug: GUZOR.slug },
    create: { ...GUZOR, status: "INACTIVE", operatingHoursStart: "06:00", operatingHoursEnd: "23:00", searchRadiusMeters: 5000, offerTimeoutSeconds: 20, offerBatchSize: 1, maxOffersPerRide: 8, searchTimeoutSeconds: 180, maxDriverDebt: 200000 },
    update: {},
  });

  if ((await prisma.serviceZone.count({ where: { cityId: guzor.id } })) === 0) {
    await prisma.serviceZone.create({
      data: {
        cityId: guzor.id,
        name: "G‘uzor pilot hududi (taxminiy)",
        boundary: circlePolygon(GUZOR.centerLat, GUZOR.centerLng, PLACEHOLDER_ZONE_RADIUS_M) as unknown as Prisma.InputJsonValue,
        note: "DIQQAT: bu Wikipedia markaz koordinatasi atrofidagi 3,5 km radiusli geometrik shakl. Ishga tushirishdan oldin litsenziyalangan ma’lumot (masalan, OpenStreetMap) asosida haqiqiy chegara bilan almashtiring.",
      },
    });
  }

  for (const t of EXAMPLE_TARIFFS) {
    const exists = await prisma.tariff.findFirst({ where: { cityId: guzor.id, vehicleClass: t.vehicleClass } });
    if (!exists) await prisma.tariff.create({ data: { ...t, cityId: guzor.id, version: 1, isActive: true } });
  }

  for (const c of INACTIVE_CITIES) {
    await prisma.city.upsert({ where: { slug: c.slug }, create: { ...c, status: "INACTIVE" }, update: {} });
  }

  if (adminPhone) {
    if (!/^\+998\d{9}$/.test(adminPhone)) throw new Error("SEED_ADMIN_PHONE must look like +998XXXXXXXXX");
    const admin = await prisma.user.upsert({ where: { phone: adminPhone }, create: { phone: adminPhone, fullName: "Bosh administrator" }, update: {} });
    await prisma.userRole.upsert({ where: { userId_role: { userId: admin.id, role: "SUPER_ADMIN" } }, create: { userId: admin.id, role: "SUPER_ADMIN" }, update: {} });
  }
  return { guzorId: guzor.id };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const adminPhone = process.env.SEED_ADMIN_PHONE ?? (process.env.NODE_ENV === "production" ? null : "+998900000001");
    if (!adminPhone) console.warn("SEED_ADMIN_PHONE not set: no administrator created.");
    await seedBaseline(prisma, adminPhone);
    console.log(`Baseline seed complete.${adminPhone ? ` SUPER_ADMIN: ${adminPhone}` : ""}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
