/**
 * DEVELOPMENT-ONLY demo data: activates G‘uzor (24h), creates a demo passenger and three
 * approved demo drivers with approved vehicles/documents and GPS positions near the centre.
 * Refuses to run when NODE_ENV=production. All names, plates and phones are fictitious test data.
 */
import "../scripts/load-env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedBaseline } from "./seed";
import { GUZOR } from "./seed-data";

// 1×1 transparent PNG used as a placeholder document image.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const DRIVERS = [
  { phone: "+998902222221", name: "Demo Haydovchi Bir", plate: "70T001DV", make: "Chevrolet", model: "Cobalt", color: "Oq", dLat: 0.004, dLng: 0.003 },
  { phone: "+998902222222", name: "Demo Haydovchi Ikki", plate: "70T002DV", make: "Chevrolet", model: "Nexia 3", color: "Kumush", dLat: -0.006, dLng: 0.005 },
  { phone: "+998902222223", name: "Demo Haydovchi Uch", plate: "70T003DV", make: "Chevrolet", model: "Gentra", color: "Qora", dLat: 0.002, dLng: -0.007 },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed-dev must not run in production");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const storageRoot = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? "./storage/private");
  try {
    const { guzorId } = await seedBaseline(prisma, process.env.SEED_ADMIN_PHONE ?? "+998900000001");
    await prisma.city.update({ where: { id: guzorId }, data: { status: "ACTIVE", operatingHoursStart: "00:00", operatingHoursEnd: "00:00" } });

    const passenger = await prisma.user.upsert({ where: { phone: "+998901111111" }, create: { phone: "+998901111111", fullName: "Demo Yo‘lovchi" }, update: {} });
    await prisma.userRole.upsert({ where: { userId_role: { userId: passenger.id, role: "PASSENGER" } }, create: { userId: passenger.id, role: "PASSENGER" }, update: {} });
    await prisma.passengerProfile.upsert({ where: { userId: passenger.id }, create: { userId: passenger.id }, update: {} });

    for (const d of DRIVERS) {
      const user = await prisma.user.upsert({ where: { phone: d.phone }, create: { phone: d.phone, fullName: d.name }, update: {} });
      await prisma.userRole.upsert({ where: { userId_role: { userId: user.id, role: "DRIVER" } }, create: { userId: user.id, role: "DRIVER" }, update: {} });
      await prisma.driverProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, status: "APPROVED", cityId: guzorId, licenseNumber: `AA${d.plate.slice(3, 6)}0000`, licenseExpiry: new Date("2030-01-01"), approvedAt: new Date() },
        update: { status: "APPROVED", cityId: guzorId },
      });
      const vehicle = await prisma.vehicle.upsert({
        where: { plateNumber: d.plate },
        create: { plateNumber: d.plate, make: d.make, model: d.model, color: d.color, year: 2021, vehicleClass: "ECONOMY", status: "APPROVED", cityId: guzorId },
        update: { status: "APPROVED" },
      });
      await prisma.driverVehicle.upsert({ where: { driverId_vehicleId: { driverId: user.id, vehicleId: vehicle.id } }, create: { driverId: user.id, vehicleId: vehicle.id, isActive: true }, update: { isActive: true } });
      for (const type of ["DRIVER_LICENSE", "PASSPORT_ID", "VEHICLE_REGISTRATION", "VEHICLE_PHOTO", "TAXI_LICENSE"] as const) {
        if (await prisma.driverDocument.findFirst({ where: { driverId: user.id, type } })) continue;
        const key = `drivers/${user.id}/${type.toLowerCase().replace(/_/g, "-")}-${randomUUID()}.png`;
        await mkdir(path.dirname(path.join(storageRoot, key)), { recursive: true });
        await writeFile(path.join(storageRoot, key), PNG);
        await prisma.driverDocument.create({ data: { driverId: user.id, type, status: "APPROVED", storageKey: key, mimeType: "image/png", sizeBytes: PNG.length, sha256: createHash("sha256").update(PNG).digest("hex"), reviewedAt: new Date() } });
      }
      await prisma.$executeRaw`
        INSERT INTO driver_locations (driver_id, lat, lng, recorded_at, updated_at)
        VALUES (${user.id}::uuid, ${GUZOR.centerLat + d.dLat}, ${GUZOR.centerLng + d.dLng}, now(), now())
        ON CONFLICT (driver_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, recorded_at = now(), updated_at = now()`;
    }
    console.log("Dev seed complete.");
    console.log("  Admin:     +998 90 000 00 01");
    console.log("  Passenger: +998 90 111 11 11");
    console.log("  Drivers:   +998 90 222 22 21 / 22 / 23 (approved, offline until they go online in the app)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
