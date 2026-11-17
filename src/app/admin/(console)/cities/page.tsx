import Link from "next/link";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { canAccessCity } from "@/lib/permissions";
import { Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CitiesPage() {
  const ctx = await staffPage("cities.view");
  if (!ctx) return <Forbidden />;
  const cities = await db().city.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { _count: { select: { zones: true, drivers: true } }, tariffs: { where: { isActive: true }, select: { id: true } } } });
  return (
    <>
      <PageHeader title="Shaharlar va xizmat hududlari" description="Shahar faollashishi uchun markaz koordinatasi, kamida bitta faol hudud va faol tarif kerak." />
      <Table head={["Shahar", "Viloyat", "Holat", "Hududlar", "Tariflar", "Haydovchilar", "Ish vaqti"]}>
        {cities
          .filter((c) => canAccessCity(ctx, c.id))
          .map((c) => (
            <tr key={c.id} className="hover:bg-surface-2/50">
              <Td>
                <Link href={`/admin/cities/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
              </Td>
              <Td className="text-muted">{c.region}</Td>
              <Td>{c.status === "ACTIVE" ? <Badge tone="success">Faol</Badge> : <Badge>Faol emas</Badge>}</Td>
              <Td className="num">{c._count.zones}</Td>
              <Td className="num">{c.tariffs.length}</Td>
              <Td className="num">{c._count.drivers}</Td>
              <Td className="num">{c.operatingHoursStart === c.operatingHoursEnd ? "24 soat" : `${c.operatingHoursStart}–${c.operatingHoursEnd}`}</Td>
            </tr>
          ))}
      </Table>
    </>
  );
}
