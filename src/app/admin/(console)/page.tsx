import Link from "next/link";
import { db } from "@/lib/db/prisma";
import { startOfLocalDay } from "@/lib/time";
import { staffPage } from "@/features/admin/page-guard";
import { financeSummary } from "@/features/payments/service";
import { hasPermission } from "@/lib/permissions";
import { PASSENGER_ACTIVE_STATUSES, RIDE_STATUS_LABELS } from "@/features/rides/state-machine";
import { Forbidden, Kpi, PageHeader, Table, Td } from "@/components/admin/ui";
import { Badge, Money } from "@/components/ui";
import { formatDateTimeUz } from "@/lib/time";
import { statusTone } from "@/features/client/types";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const ctx = await staffPage("dashboard.view");
  if (!ctx) return <Forbidden />;
  const today = startOfLocalDay(new Date(), "Asia/Tashkent");
  const [activeRides, online, todayRides, todayCancelled, todayNoDriver, pendingDrivers, openTickets, openIncidents, recent] = await Promise.all([
    db().ride.count({ where: { status: { in: PASSENGER_ACTIVE_STATUSES } } }),
    db().driverProfile.count({ where: { availability: "ONLINE" } }),
    db().ride.count({ where: { status: "SETTLED", settledAt: { gte: today } } }),
    db().ride.count({ where: { status: "CANCELLED", cancelledAt: { gte: today } } }),
    db().ride.count({ where: { status: "NO_DRIVER", updatedAt: { gte: today } } }),
    db().driverProfile.count({ where: { status: "PENDING_REVIEW" } }),
    db().supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db().safetyIncident.count({ where: { status: { not: "RESOLVED" } } }),
    db().ride.findMany({ orderBy: { requestedAt: "desc" }, take: 10, include: { city: { select: { name: true } } } }),
  ]);
  const finance = hasPermission(ctx, "finance.view") ? await financeSummary({ from: today, to: new Date(Date.now() + 60_000) }) : null;
  return (
    <>
      <PageHeader title="Umumiy holat" description={`Bugun (${formatDateTimeUz(new Date()).slice(0, 10)}, Toshkent vaqti) bo‘yicha jonli ko‘rsatkichlar.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Faol safarlar" value={activeRides} href="/admin/live" />
        <Kpi label="Onlayn haydovchilar" value={online} href="/admin/live" />
        <Kpi label="Bugun yakunlangan" value={todayRides} hint={`${todayCancelled} bekor · ${todayNoDriver} haydovchisiz`} />
        {finance ? <Kpi label="Bugungi komissiya" value={<Money amount={finance.commissionAccrued} size="lg" />} href="/admin/finance" /> : <Kpi label="Bugungi safarlar" value={todayRides} />}
        <Kpi label="Tekshiruvdagi arizalar" value={pendingDrivers} href="/admin/verification" />
        <Kpi label="Ochiq murojaatlar" value={openTickets} href="/admin/support" />
        <Kpi label="Ochiq xavfsizlik hodisalari" value={openIncidents} href="/admin/incidents" />
        {finance && <Kpi label="Haydovchilar qarzi (jami)" value={<Money amount={finance.outstandingReceivable} size="lg" />} href="/admin/finance" />}
      </div>
      <h2 className="mt-8 mb-3 font-semibold">So‘nggi buyurtmalar</h2>
      <Table head={["Kod", "Vaqt", "Shahar", "Holat", "Narx"]} empty="Hali buyurtmalar yo‘q">
        {recent.map((r) => (
          <tr key={r.id} className="hover:bg-surface-2/50">
            <Td>
              <Link className="font-mono font-medium underline-offset-2 hover:underline" href={`/admin/rides/${r.id}`}>
                {r.code}
              </Link>
            </Td>
            <Td className="text-muted">{formatDateTimeUz(r.requestedAt)}</Td>
            <Td>{r.city.name}</Td>
            <Td>
              <Badge tone={statusTone(r.status)}>{RIDE_STATUS_LABELS[r.status]}</Badge>
            </Td>
            <Td>
              <Money amount={r.finalFare ?? r.quotedFare} size="sm" />
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
