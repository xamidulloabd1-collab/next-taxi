import Link from "next/link";
import type { DriverStatus, Prisma } from "@prisma/client";
import { DRIVER_STATUS } from "@/features/admin/labels";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { FilterTabs, Forbidden, PageHeader, SearchForm, Table, Td } from "@/components/admin/ui";
import { Badge, Plate } from "@/components/ui";
import { maskUzPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await staffPage("drivers.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const status = sp.status && sp.status in DRIVER_STATUS ? (sp.status as DriverStatus) : undefined;
  const q = sp.q?.trim();
  const where: Prisma.DriverProfileWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ user: { fullName: { contains: q, mode: "insensitive" } } }, { user: { phone: { contains: q.replace(/\D/g, "") || "-" } } }, { vehicles: { some: { vehicle: { plateNumber: { contains: q.toUpperCase().replace(/[^A-Z0-9]/g, "") || "-" } } } } }] } : {}),
  };
  const rows = await db().driverProfile.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { user: true, city: true, vehicles: { where: { isActive: true }, include: { vehicle: true } } } });
  return (
    <>
      <PageHeader title="Haydovchilar" description={`${rows.length} ta ko‘rsatilmoqda`} />
      <SearchForm action="/admin/drivers" q={q} placeholder="Ism, telefon yoki davlat raqami" />
      <FilterTabs base="/admin/drivers" current={status ?? ""} options={[["", "Hammasi"], ...Object.entries(DRIVER_STATUS).map(([k, v]) => [k, v.l] as [string, string])]} />
      <Table head={["Haydovchi", "Shahar", "Avtomobil", "Holat", "Ish holati", "Reyting"]} empty="Haydovchi topilmadi">
        {rows.map((d) => (
          <tr key={d.userId} className="hover:bg-surface-2/50">
            <Td>
              <Link href={`/admin/drivers/${d.userId}`} className="font-medium hover:underline">
                {d.user.fullName ?? "Ism kiritilmagan"}
              </Link>
              <span className="block text-xs text-muted num">{maskUzPhone(d.user.phone)}</span>
            </Td>
            <Td>{d.city?.name ?? "—"}</Td>
            <Td>{d.vehicles[0] ? <Plate plate={d.vehicles[0].vehicle.plateNumber} size="sm" /> : "—"}</Td>
            <Td>
              <Badge tone={DRIVER_STATUS[d.status].t}>{DRIVER_STATUS[d.status].l}</Badge>
              {d.user.status === "BLOCKED" && <Badge tone="danger" className="ml-1">Bloklangan</Badge>}
            </Td>
            <Td>{d.availability === "ONLINE" ? <Badge tone="success">Onlayn</Badge> : <span className="text-muted">Oflayn</span>}</Td>
            <Td className="num">{d.ratingCount ? (d.ratingSum / d.ratingCount).toFixed(1) : "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
