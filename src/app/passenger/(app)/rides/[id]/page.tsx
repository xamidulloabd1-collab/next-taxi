"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LifeBuoy, Star } from "lucide-react";
import { api } from "@/lib/client/api";
import { PageShell } from "@/components/shared/page-shell";
import { Alert, Badge, Button, Card, Money, Plate, RouteRail, Skeleton } from "@/components/ui";
import { fmtDateTime, fmtDistance, fmtMinutes, placeLabel, statusTone, type PassengerRide } from "@/features/client/types";

const STEP_LABELS: Record<string, string> = {
  REQUESTED: "Buyurtma berildi",
  SEARCHING: "Haydovchi qidirildi",
  ASSIGNED: "Haydovchi qabul qildi",
  ARRIVING: "Haydovchi yo‘lga chiqdi",
  ARRIVED: "Haydovchi yetib keldi",
  IN_PROGRESS: "Safar boshlandi",
  COMPLETED: "Safar yakunlandi",
  SETTLED: "To‘lov tasdiqlandi",
  CANCELLED: "Bekor qilindi",
  NO_DRIVER: "Haydovchi topilmadi",
};

export default function RideDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["passenger-ride-detail", id], queryFn: () => api<{ ride: PassengerRide; timeline: { status: string; at: string }[] }>(`/passenger/rides/${id}`) });
  const r = q.data?.ride;
  return (
    <PageShell
      title={r ? r.code : "Safar"}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/passenger/history">
            <ArrowLeft className="size-4" /> Orqaga
          </Link>
        </Button>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError || !r ? (
        <Alert tone="danger">Safar topilmadi.</Alert>
      ) : (
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <div className="flex items-start justify-between">
              <Badge tone={statusTone(r.status)}>{r.statusLabel}</Badge>
              <Money amount={r.finalFare ?? r.quotedFare} size="lg" />
            </div>
            <RouteRail pickup={placeLabel(r.pickup)} dropoff={placeLabel(r.dropoff)} />
            <p className="text-sm text-muted num">
              {fmtDistance(r.distanceMeters)} · {fmtMinutes(r.durationSeconds)} · Naqd
            </p>
            {r.cancelReason && <Alert tone="neutral">Sabab: {r.cancelReason}</Alert>}
          </Card>
          {r.vehicle && r.driver && (
            <Card className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{r.driver.name}</p>
                <p className="text-sm text-muted">
                  {r.vehicle.color} {r.vehicle.make} {r.vehicle.model}
                </p>
              </div>
              <Plate plate={r.vehicle.plateNumber} size="sm" />
            </Card>
          )}
          {r.myRating && (
            <p className="flex items-center gap-1 text-sm text-muted">
              Bahoyingiz: {Array.from({ length: r.myRating.score }).map((_, i) => <Star key={i} className="size-4 fill-warn text-warn" />)}
            </p>
          )}
          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold">Safar tarixi</p>
            <ol className="space-y-2.5 border-l border-border pl-4">
              {q.data!.timeline.map((t, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-accent" />
                  <span>{STEP_LABELS[t.status] ?? t.status}</span>
                  <span className="ml-2 text-xs text-muted">{fmtDateTime(t.at)}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Button asChild variant="outline" block>
            <Link href={`/passenger/support?ride=${r.id}`}>
              <LifeBuoy className="size-4" /> Shu safar bo‘yicha murojaat
            </Link>
          </Button>
        </div>
      )}
    </PageShell>
  );
}
