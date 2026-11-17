import { staffPage } from "@/features/admin/page-guard";
import { Forbidden, PageHeader } from "@/components/admin/ui";
import { db } from "@/lib/db/prisma";
import { LiveOps } from "./live-ops";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const ctx = await staffPage("rides.view");
  if (!ctx) return <Forbidden />;
  const city = await db().city.findFirst({ where: { status: "ACTIVE" }, include: { zones: { where: { isActive: true } } } });
  return (
    <>
      <PageHeader title="Jonli safarlar" description="Faol buyurtmalar va onlayn haydovchilar. Ma’lumot real vaqtda yangilanadi." />
      <LiveOps
        center={city?.centerLat != null && city.centerLng != null ? { lat: city.centerLat, lng: city.centerLng } : { lat: 38.62083, lng: 66.24806 }}
        zones={(city?.zones ?? []).map((z) => z.boundary as unknown as { type: "Polygon"; coordinates: [number, number][][] })}
      />
    </>
  );
}
