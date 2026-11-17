import Link from "next/link";
import type { Prisma, RideStatus } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { FilterTabs, Forbidden, PageHeader, SearchForm, Table, Td } from "@/components/admin/ui";
import { Badge, Money } from "@/components/ui";
import { RIDE_STATUS_LABELS } from "@/features/rides/state-machine";
import { formatDateTimeUz } from "@/lib/time";
import { statusTone } from "@/features/client/types";
import { maskUzPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(RIDE_STATUS_LABELS) as RideStatus[];

export default async function RidesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const ctx = await staffPage("rides.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as RideStatus) ? (sp.status as RideStatus) : undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = sp.q?.trim();
  const where: Prisma.RideWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ code: { contains: q.toUpperCase() } }, { passenger: { phone: { contains: q.replace(/\D/g, "") || "-" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db().ride.findMany({ where, orderBy: { requestedAt: "desc" }, take: 50, skip: (page - 1) * 50, include: { passenger: { select: { phone: true, fullName: true } }, driver: { include: { user: { select: { fullName: true } } } }, city: { select: { name: true } } } }),
    db().ride.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Safarlar tarixi" description={`${total} ta buyurtma`} />
      <SearchForm action="/admin/rides" q={q} placeholder="Kod (NT-…) yoki yo‘lovchi telefoni" />
      <FilterTabs base="/admin/rides" current={status ?? ""} options={[["", "Hammasi"], ...STATUSES.map((s) => [s, RIDE_STATUS_LABELS[s]] as [string, string])]} />
      <Table head={["Kod", "Vaqt", "Yo‘lovchi", "Haydovchi", "Holat", "Narx", "Komissiya"]} empty="Buyurtma topilmadi">
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-surface-2/50">
            <Td>
              <Link className="font-mono font-medium hover:underline" href={`/admin/rides/${r.id}`}>
                {r.code}
              </Link>
              <span className="block text-xs text-muted">{r.city.name}</span>
            </Td>
            <Td className="text-muted">{formatDateTimeUz(r.requestedAt)}</Td>
            <Td>
              {r.passenger.fullName ?? "—"}
              <span className="block text-xs text-muted num">{maskUzPhone(r.passenger.phone)}</span>
            </Td>
            <Td>{r.driver?.user.fullName ?? "—"}</Td>
            <Td>
              <Badge tone={statusTone(r.status)}>{RIDE_STATUS_LABELS[r.status]}</Badge>
            </Td>
            <Td>
              <Money amount={r.finalFare ?? r.quotedFare} size="sm" />
            </Td>
            <Td>
              <Money amount={r.commissionAmount} size="sm" />
            </Td>
          </tr>
        ))}
      </Table>
      <div className="mt-4 flex gap-2 text-sm">
        {page > 1 && <Link className="rounded-lg border border-border px-3 py-1.5" href={`/admin/rides?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}), page: String(page - 1) })}`}>← Oldingi</Link>}
        {page * 50 < total && <Link className="rounded-lg border border-border px-3 py-1.5" href={`/admin/rides?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}), page: String(page + 1) })}`}>Keyingi →</Link>}
      </div>
    </>
  );
}
