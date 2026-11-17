"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LogOut, Star } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import { PageShell } from "@/components/shared/page-shell";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button, Card, Field, Input, Skeleton } from "@/components/ui";

export default function ProfilePage() {
  const router = useRouter();
  const q = useQuery({ queryKey: ["passenger-profile"], queryFn: () => api<{ phone: string; fullName: string | null; rating: number | null; ridesCount: number }>("/passenger/profile") });
  const [name, setName] = useState("");
  useEffect(() => setName(q.data?.fullName ?? ""), [q.data?.fullName]);
  const save = useMutation({
    mutationFn: () => api("/passenger/profile", { method: "PATCH", body: { fullName: name } }),
    onSuccess: () => toast.success("Saqlandi."),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { body: { app: "passenger" } }),
    onSuccess: () => router.replace("/passenger/login"),
  });
  return (
    <PageShell title="Profil">
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4">
          <Card className="grid grid-cols-2 divide-x divide-border">
            <div className="p-4">
              <p className="text-xs text-muted">Safarlar</p>
              <p className="mt-1 text-2xl font-bold num">{q.data?.ridesCount ?? 0}</p>
            </div>
            <div className="p-4">
              <p className="text-xs text-muted">Reytingingiz</p>
              <p className="mt-1 flex items-center gap-1 text-2xl font-bold num">
                {q.data?.rating ? (
                  <>
                    {q.data.rating.toFixed(1)} <Star className="size-5 fill-warn text-warn" />
                  </>
                ) : (
                  "—"
                )}
              </p>
            </div>
          </Card>
          <Card className="space-y-3 p-4">
            <Field label="Telefon">
              <Input value={q.data?.phone ?? ""} disabled className="num" />
            </Field>
            <Field label="Ism" hint="Haydovchi sizni shu ism bilan ko‘radi.">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={name.trim().length < 2}>
              Saqlash
            </Button>
          </Card>
          <ThemeToggle />
          <Button variant="danger-outline" block onClick={() => logout.mutate()} loading={logout.isPending}>
            <LogOut className="size-4" /> Chiqish
          </Button>
          <p className="text-center text-xs text-muted">
            <a href="/legal/privacy" className="underline">
              Maxfiylik siyosati
            </a>{" "}
            ·{" "}
            <a href="/legal/terms" className="underline">
              Foydalanish shartlari
            </a>
          </p>
        </div>
      )}
    </PageShell>
  );
}
