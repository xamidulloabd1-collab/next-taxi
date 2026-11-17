"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { api } from "@/lib/client/api";
import { PageShell } from "@/components/shared/page-shell";
import { Badge, Button, EmptyState, Money, Skeleton } from "@/components/ui";
import { fmtDateTime, fmtDistance, placeLabel, statusTone, type DriverRide } from "@/features/client/types";

export default function DriverHistory() {
  const q = useInfiniteQuery({
    queryKey: ["driver-history"],
    queryFn: ({ pageParam }) => api<{ items: DriverRide[]; nextCursor: string | null }>(`/driver/rides${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <PageShell title="Safarlar">
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Clock3 className="size-5" />} title="Safarlar hali yo‘q" description="Qabul qilgan buyurtmalaringiz shu yerda ko‘rinadi." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  {fmtDateTime(r.timestamps.requestedAt)} · {r.code}
                </span>
                <Badge tone={statusTone(r.status)}>{r.statusLabel}</Badge>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm">{placeLabel(r.dropoff, "Manzil")}</p>
                <div className="text-right">
                  <Money amount={r.driverEarnings ?? r.quotedFare} size="sm" />
                  <p className="text-xs text-muted num">{fmtDistance(r.distanceMeters)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <Button variant="ghost" block className="mt-3" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Yana ko‘rsatish
        </Button>
      )}
    </PageShell>
  );
}
