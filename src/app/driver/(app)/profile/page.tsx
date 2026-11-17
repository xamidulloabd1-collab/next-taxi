"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, LogOut, Star } from "lucide-react";
import { api } from "@/lib/client/api";
import { PageShell } from "@/components/shared/page-shell";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Badge, Button, Card, Plate, Skeleton } from "@/components/ui";

const STATUS: Record<string, string> = { PENDING_DOCUMENTS: "Ariza to‘ldirilmagan", PENDING_REVIEW: "Tekshiruvda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan", SUSPENDED: "To‘xtatilgan" };

export default function DriverProfile() {
  const router = useRouter();
  const q = useQuery({
    queryKey: ["driver-overview"],
    queryFn: () => api<{ driver: { fullName: string | null; phone: string; status: string; rating: number | null; city: { name: string } | null; vehicle: { plateNumber: string; make: string; model: string; color: string } | null } }>("/driver/profile").then((r) => r.driver),
  });
  const logout = useMutation({ mutationFn: () => api("/auth/logout", { body: { app: "driver" } }), onSuccess: () => router.replace("/driver/login") });
  const d = q.data;
  return (
    <PageShell title="Profil">
      {!d ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{d.fullName ?? "Ism kiritilmagan"}</p>
                <p className="text-sm text-muted num">{d.phone}</p>
                <p className="text-sm text-muted">{d.city?.name ?? "Shahar tanlanmagan"}</p>
              </div>
              <Badge tone={d.status === "APPROVED" ? "success" : d.status === "SUSPENDED" || d.status === "REJECTED" ? "danger" : "warn"}>{STATUS[d.status] ?? d.status}</Badge>
            </div>
            {d.rating != null && (
              <p className="flex items-center gap-1 text-sm">
                <Star className="size-4 fill-warn text-warn" /> <span className="font-semibold num">{d.rating.toFixed(1)}</span> <span className="text-muted">reyting</span>
              </p>
            )}
            {d.vehicle && (
              <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
                <span className="text-sm">
                  {d.vehicle.color} {d.vehicle.make} {d.vehicle.model}
                </span>
                <Plate plate={d.vehicle.plateNumber} size="sm" />
              </div>
            )}
          </Card>
          <Button asChild variant="outline" block className="justify-start">
            <Link href="/driver/onboarding">
              <FileText className="size-4" /> Ariza va hujjatlar
            </Link>
          </Button>
          <ThemeToggle />
          <Button variant="danger-outline" block onClick={() => logout.mutate()} loading={logout.isPending}>
            <LogOut className="size-4" /> Chiqish
          </Button>
        </div>
      )}
    </PageShell>
  );
}
