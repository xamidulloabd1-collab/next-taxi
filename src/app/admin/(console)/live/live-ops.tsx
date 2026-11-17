"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MapView, type MapPoint } from "@/components/maps/map-view";
import { Badge, Money, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useRealtime } from "@/lib/client/realtime";
import { statusTone } from "@/features/client/types";

interface Live {
  rides: { id: string; code: string; status: string; statusLabel: string; city: string; pickup: { lat: number; lng: number; address: string | null }; fare: number; requestedAt: string; pendingOffers: number; driver: { name: string | null; gpsStale: boolean } | null }[];
  drivers: { id: string; name: string | null; busy: boolean; plate: string | null; location: { lat: number; lng: number } | null; gpsStale: boolean }[];
  at: string;
}

export function LiveOps({ center, zones }: { center: { lat: number; lng: number }; zones: { type: "Polygon"; coordinates: [number, number][][] }[] }) {
  const { connected } = useRealtime("admin");
  const q = useQuery({ queryKey: ["admin-live"], queryFn: () => api<Live>("/admin/live"), refetchInterval: 8000 });
  const points: MapPoint[] = [
    ...(q.data?.drivers.filter((d) => d.location).map((d) => ({ id: d.id, lat: d.location!.lat, lng: d.location!.lng, kind: d.gpsStale ? ("stale" as const) : d.busy ? ("busy" as const) : ("available" as const), label: `${d.name ?? ""} ${d.plate ?? ""}` })) ?? []),
    ...(q.data?.rides.filter((r) => r.status === "SEARCHING").map((r) => ({ id: `ride-${r.id}`, lat: r.pickup.lat, lng: r.pickup.lng, kind: "pickup" as const, label: r.code })) ?? []),
  ];
  const available = q.data?.drivers.filter((d) => !d.busy && !d.gpsStale).length ?? 0;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="relative h-[60vh] overflow-hidden rounded-2xl border border-border xl:h-[calc(100dvh-180px)]">
        <MapView controls className="absolute inset-0" center={center} zoom={13} zones={zones} points={points} />
        <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 rounded-xl bg-surface/95 px-3 py-2 text-xs shadow">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#16a34a]" /> Bo‘sh ({available})</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#d97706]" /> Buyurtmada</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#94a3b8]" /> GPS eskirgan</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#0b1220]" /> Qidiruvdagi buyurtma</span>
        </div>
      </div>
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-xs text-muted">
          <span className={connected ? "size-2 rounded-full bg-accent" : "size-2 rounded-full bg-warn"} />
          {connected ? "Real vaqt ulanishi faol" : "Qayta ulanmoqda — har 8 soniyada yangilanadi"}
          {q.isFetching && <Spinner className="size-3" />}
        </p>
        {q.data?.rides.length === 0 && <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">Hozir faol buyurtma yo‘q.</p>}
        <ul className="space-y-2">
          {q.data?.rides.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/rides/${r.id}`} className="block rounded-xl border border-border bg-surface p-3 hover:border-fg/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{r.code}</span>
                  <Badge tone={statusTone(r.status)}>{r.statusLabel}</Badge>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-sm">
                  <span className="truncate text-muted">
                    {r.driver ? `${r.driver.name ?? "Haydovchi"}${r.driver.gpsStale ? " · GPS eskirgan" : ""}` : r.pendingOffers ? `Taklif yuborilgan (${r.pendingOffers})` : "Haydovchi kutilmoqda"}
                  </span>
                  <Money amount={r.fare} size="sm" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
