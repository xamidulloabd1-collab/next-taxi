"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, Clock3 } from "lucide-react";
import { api } from "@/lib/client/api";
import { PageShell } from "@/components/shared/page-shell";
import { Badge, Button, EmptyState, Money, Skeleton } from "@/components/ui";
import { fmtDateTime, placeLabel, statusTone, type PassengerRide } from "@/features/client/types";

export default function HistoryPage() {
  const q = useInfiniteQuery({
    queryKey: ["passenger-history"],
    queryFn: ({ pageParam }) => api<{ items: PassengerRide[]; nextCursor: string | null }>(`/passenger/rides${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <PageShell title="Safarlar">
      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Clock3 className="size-5" />} title="Hali safar qilmagansiz" description="Birinchi buyurtmangizdan keyin safarlar shu yerda saqlanadi." action={<Button asChild><Link href="/passenger">Taksi chaqirish</Link></Button>} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((r) => (
            <li key={r.id}>
              <Link href={`/passenger/rides/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">{fmtDateTime(r.timestamps.requestedAt)}</span>
                    <Badge tone={statusTone(r.status)}>{r.statusLabel}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm">{placeLabel(r.dropoff, "Manzil")}</p>
                </div>
                <Money amount={r.finalFare ?? r.quotedFare} size="sm" />
                <ChevronRight className="size-4 text-muted" />
              </Link>
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
