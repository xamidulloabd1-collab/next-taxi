import Link from "next/link";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { hasPermission } from "@/lib/permissions";
import { driverBalances, financeSummary, reconcile } from "@/features/payments/service";
import { FilterTabs, Forbidden, Kpi, PageHeader, Table, Td } from "@/components/admin/ui";
import { Alert, Card, CardHeader, Money } from "@/components/ui";
import { startOfLocalDay, formatDateTimeUz } from "@/lib/time";
import { maskUzPhone } from "@/lib/phone";
import { SettlementForm } from "./settlement-form";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = { today: 1, "7d": 7, "30d": 30 };
const METHOD: Record<string, string> = { CASH_AT_OFFICE: "Ofisda naqd", BANK_TRANSFER: "Bank o‘tkazmasi", CARD_TRANSFER: "Karta o‘tkazmasi" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await staffPage("finance.view");
  if (!ctx) return <Forbidden />;
  const range = (await searchParams).range ?? "today";
  const days = RANGES[range] ?? 1;
  const from = new Date(startOfLocalDay(new Date(), "Asia/Tashkent").getTime() - (days - 1) * 86_400_000);
  const [summary, balances, issues, settlements] = await Promise.all([
    financeSummary({ from, to: new Date(Date.now() + 60_000) }),
    driverBalances(),
    reconcile(),
    db().settlement.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { driver: { include: { user: { select: { fullName: true } } } } } }),
  ]);
  const owing = balances.filter((b) => Number(b.outstanding) > 0);
  const canSettle = hasPermission(ctx, "settlements.manage");
  return (
    <>
      <PageHeader title="Moliya va hisob-kitob" description="Naqd to‘lovda yo‘lovchi pulni haydovchiga beradi; platforma komissiyasi haydovchining qarzi sifatida hisoblanadi va to‘langanda yopiladi." />
      <FilterTabs base="/admin/finance" param="range" current={range} options={[["today", "Bugun"], ["7d", "7 kun"], ["30d", "30 kun"]]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Yakunlangan safarlar" value={summary.settledRides} />
        <Kpi label="Safarlar summasi (yo‘lovchilar to‘lagan)" value={<Money amount={summary.grossFares} size="lg" />} />
        <Kpi label="Hisoblangan komissiya" value={<Money amount={summary.commissionAccrued} size="lg" />} />
        <Kpi label="Haydovchilardan olingan" value={<Money amount={summary.settlementsReceived} size="lg" />} />
        <Kpi label="Jami qarz (hozir)" value={<Money amount={summary.outstandingReceivable} size="lg" />} />
      </div>

      <div className="mt-4">
        {issues.length === 0 ? (
          <Alert tone="success" title="Solishtirish: tafovut yo‘q">Safarlar, to‘lovlar va ledger yozuvlari bir-biriga mos ({formatDateTimeUz(new Date())}).</Alert>
        ) : (
          <Alert tone="danger" title={`Solishtirish: ${issues.length} ta tafovut`}>
            <ul className="mt-1 list-disc pl-5">
              {issues.slice(0, 10).map((i, k) => (
                <li key={k}>
                  {i.kind}: {i.detail} {i.rideId && <Link className="underline" href={`/admin/rides/${i.rideId}`}>ko‘rish</Link>}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Haydovchilar komissiya qarzi" description={`${owing.length} ta haydovchi qarzdor`} />
          <Table head={["Haydovchi", "Hisoblangan", "To‘langan", "Qarz"]} empty="Qarzdor haydovchi yo‘q">
            {owing.map((b) => (
              <tr key={b.driver_id}>
                <Td>
                  <Link href={`/admin/drivers/${b.driver_id}`} className="font-medium hover:underline">
                    {b.full_name ?? "—"}
                  </Link>
                  <span className="block text-xs text-muted num">{maskUzPhone(b.phone)}</span>
                </Td>
                <Td><Money amount={Number(b.accrued)} size="sm" /></Td>
                <Td><Money amount={Number(b.settled)} size="sm" /></Td>
                <Td><Money amount={Number(b.outstanding)} size="sm" className="text-warn" /></Td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-4">
          {canSettle && <SettlementForm drivers={owing.map((b) => ({ id: b.driver_id, name: b.full_name ?? b.phone, outstanding: Number(b.outstanding) }))} />}
          <Card>
            <CardHeader title="So‘nggi to‘lovlar" />
            <ul className="divide-y divide-border border-t border-border">
              {settlements.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{s.driver.user.fullName}</span>
                    <span className="text-xs text-muted">
                      {METHOD[s.method]} · {formatDateTimeUz(s.createdAt)}
                      {s.reference ? ` · ${s.reference}` : ""}
                    </span>
                  </span>
                  <Money amount={s.amount} size="sm" />
                </li>
              ))}
              {settlements.length === 0 && <li className="px-5 py-4 text-sm text-muted">Hali to‘lov qayd etilmagan.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
