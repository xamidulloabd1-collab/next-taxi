import { notFound } from "next/navigation";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { canAccessCity, hasPermission } from "@/lib/permissions";
import { Forbidden, PageHeader } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { CityEditor } from "./city-editor";

export const dynamic = "force-dynamic";

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await staffPage("cities.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const city = await db().city.findUnique({ where: { id }, include: { zones: { orderBy: { createdAt: "asc" } } } });
  if (!city) notFound();
  if (!canAccessCity(ctx, id)) return <Forbidden />;
  const areas = await db().$queryRaw<{ id: string; km2: number }[]>`SELECT id::text, (ST_Area(area::geography) / 1e6)::float8 AS km2 FROM service_zones WHERE city_id = ${id}::uuid`;
  const kmById = new Map(areas.map((a) => [a.id, a.km2]));
  return (
    <>
      <PageHeader title={city.name} description={city.region} actions={city.status === "ACTIVE" ? <Badge tone="success">Faol</Badge> : <Badge>Faol emas</Badge>} />
      <CityEditor
        canEdit={hasPermission(ctx, "cities.manage")}
        city={{
          id: city.id,
          status: city.status,
          centerLat: city.centerLat,
          centerLng: city.centerLng,
          defaultZoom: city.defaultZoom,
          operatingHoursStart: city.operatingHoursStart,
          operatingHoursEnd: city.operatingHoursEnd,
          searchRadiusMeters: city.searchRadiusMeters,
          offerTimeoutSeconds: city.offerTimeoutSeconds,
          offerBatchSize: city.offerBatchSize,
          maxOffersPerRide: city.maxOffersPerRide,
          searchTimeoutSeconds: city.searchTimeoutSeconds,
          maxDriverDebt: city.maxDriverDebt,
        }}
        zones={city.zones.map((z) => ({ id: z.id, name: z.name, isActive: z.isActive, note: z.note, boundary: z.boundary as unknown as { type: "Polygon"; coordinates: [number, number][][] }, km2: kmById.get(z.id) ?? null }))}
      />
    </>
  );
}
