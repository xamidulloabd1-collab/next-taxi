"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { PageShell } from "@/components/shared/page-shell";
import { Alert, Card, CardHeader, Money, Skeleton } from "@/components/ui";
import { fmtDateTime } from "@/features/client/types";

interface Earnings {
  today: { rides: number; gross: number; commission: number; net: number };
  days: { date: string; rides: number; gross: number; commission: number; net: number }[];
  outstandingCommission: number;
  maxDebt: number | null;
  settlements: { id: string; amount: number; method: string; createdAt: string }[];
}

const METHOD: Record<string, string> = { CASH_AT_OFFICE: "Ofisda naqd", BANK_TRANSFER: "Bank o‘tkazmasi", CARD_TRANSFER: "Karta o‘tkazmasi" };

export default function EarningsPage() {
  const q = useQuery({ queryKey: ["driver-earnings"], queryFn: () => api<Earnings>("/driver/earnings") });
  const e = q.data;
  const maxNet = Math.max(1, ...(e?.days.map((d) => d.net) ?? [1]));
  return (
    <PageShell title="Daromad">
      {q.isLoading || !e ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <p className="text-sm text-muted">Bugun sizga qoldi</p>
            <Money amount={e.today.net} size="xl" />
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
              <div>
                <p className="text-xs text-muted">Safarlar</p>
                <p className="font-semibold num">{e.today.rides}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Jami tushum</p>
                <Money amount={e.today.gross} size="sm" />
              </div>
              <div>
                <p className="text-xs text-muted">Komissiya</p>
                <Money amount={e.today.commission} size="sm" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Komissiya qarzi" description="Yo‘lovchilardan naqd olgan pulingizdan platformaga to‘lanadigan ulush." />
            <div className="px-5 pb-5">
              <Money amount={e.outstandingCommission} size="lg" />
              {e.maxDebt != null && (
                <p className="mt-1 text-xs text-muted">
                  Limit: <Money amount={e.maxDebt} size="sm" /> — limitdan oshsa, onlayn bo‘lib bo‘lmaydi.
                </p>
              )}
              {e.maxDebt != null && e.outstandingCommission > e.maxDebt * 0.8 && <Alert tone="warn" className="mt-3">Qarz limitga yaqin. To‘lovni ofisda yoki o‘tkazma orqali amalga oshiring.</Alert>}
            </div>
          </Card>

          <Card>
            <CardHeader title="So‘nggi 7 kun" />
            <ul className="space-y-2 px-5 pb-5">
              {e.days.map((d) => (
                <li key={d.date} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-muted num">{d.date.slice(5).split("-").reverse().join(".")}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(d.net / maxNet) * 100}%` }} />
                  </span>
                  <Money amount={d.net} size="sm" />
                </li>
              ))}
            </ul>
          </Card>

          {e.settlements.length > 0 && (
            <Card>
              <CardHeader title="Komissiya to‘lovlari" />
              <ul className="divide-y divide-border border-t border-border">
                {e.settlements.map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span>
                      {METHOD[s.method] ?? s.method}
                      <span className="block text-xs text-muted">{fmtDateTime(s.createdAt)}</span>
                    </span>
                    <Money amount={s.amount} size="sm" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </PageShell>
  );
}
