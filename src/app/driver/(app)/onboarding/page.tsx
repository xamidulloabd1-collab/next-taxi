"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Clock, FileUp, X } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import { PageShell } from "@/components/shared/page-shell";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Plate, Select, Skeleton } from "@/components/ui";
import type { CitiesResponse } from "@/features/client/types";

interface Doc {
  id: string;
  type: string;
  label: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
}
interface Overview {
  status: string;
  fullName: string | null;
  city: { id: string } | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  documents: Doc[];
  missingDocuments: { type: string; label: string }[];
  vehicle: { plateNumber: string; make: string; model: string; color: string; year: number; vehicleClass: string; status: string; rejectionReason: string | null } | null;
}

const DOC_TYPES = [
  ["DRIVER_LICENSE", "Haydovchilik guvohnomasi", true],
  ["PASSPORT_ID", "Pasport / ID karta", true],
  ["VEHICLE_REGISTRATION", "Texpasport", true],
  ["VEHICLE_PHOTO", "Avtomobil surati (davlat raqami ko‘rinsin)", true],
  ["TAXI_LICENSE", "Taksi faoliyati litsenziyasi", true],
  ["SELF_EMPLOYED_CERT", "O‘zini o‘zi band qilgan shaxs guvohnomasi", false],
  ["INSURANCE", "Sug‘urta polisi (OSAGO)", false],
] as const;

const REVIEW = { PENDING: { t: "Tekshirilmoqda", tone: "warn" as const, I: Clock }, APPROVED: { t: "Tasdiqlandi", tone: "success" as const, I: Check }, REJECTED: { t: "Rad etildi", tone: "danger" as const, I: X } };

export default function Onboarding() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["driver-overview"], queryFn: () => api<{ driver: Overview }>("/driver/profile").then((r) => r.driver) });
  const cities = useQuery({ queryKey: ["cities"], queryFn: () => api<CitiesResponse>("/cities"), staleTime: 300_000 });
  const d = q.data;
  const locked = d?.status === "PENDING_REVIEW" || d?.status === "APPROVED";
  const refresh = () => void qc.invalidateQueries({ queryKey: ["driver-overview"] });

  const [profile, setProfile] = useState({ fullName: "", cityId: "", licenseNumber: "", licenseExpiry: "" });
  const [vehicle, setVehicle] = useState({ plateNumber: "", make: "Chevrolet", model: "", color: "", year: 2020, seats: 4, vehicleClass: "ECONOMY" });
  useEffect(() => {
    if (!d) return;
    setProfile({ fullName: d.fullName ?? "", cityId: d.city?.id ?? "", licenseNumber: d.licenseNumber ?? "", licenseExpiry: d.licenseExpiry?.slice(0, 10) ?? "" });
    if (d.vehicle) setVehicle({ plateNumber: d.vehicle.plateNumber, make: d.vehicle.make, model: d.vehicle.model, color: d.vehicle.color, year: d.vehicle.year, seats: 4, vehicleClass: d.vehicle.vehicleClass });
  }, [d]);

  const saveProfile = useMutation({ mutationFn: () => api("/driver/profile", { method: "PUT", body: profile }), onSuccess: () => (toast.success("Ma’lumotlar saqlandi."), refresh()), onError: (e) => toast.error(errorMessage(e)) });
  const saveVehicle = useMutation({ mutationFn: () => api("/driver/vehicle", { method: "PUT", body: vehicle }), onSuccess: () => (toast.success("Avtomobil saqlandi."), refresh()), onError: (e) => toast.error(errorMessage(e)) });
  const submit = useMutation({ mutationFn: () => api("/driver/submit", { method: "POST" }), onSuccess: () => (toast.success("Ariza tekshiruvga yuborildi."), refresh()), onError: (e) => toast.error(errorMessage(e)) });

  if (q.isLoading || !d) return <PageShell title="Ariza"><Skeleton className="h-96" /></PageShell>;
  const latest = new Map(d.documents.map((x) => [x.type, x]));

  return (
    <PageShell title="Haydovchi arizasi" action={<Button asChild variant="ghost" size="sm"><Link href="/driver"><ArrowLeft className="size-4" /> Orqaga</Link></Button>}>
      <div className="space-y-4">
        {d.status === "PENDING_REVIEW" && <Alert tone="warn" title="Ariza tekshirilmoqda">Tekshiruv tugaguncha ma’lumotlarni o‘zgartirib bo‘lmaydi.</Alert>}
        {d.status === "APPROVED" && <Alert tone="success" title="Ariza tasdiqlangan">Siz buyurtma olishingiz mumkin.</Alert>}

        <Card>
          <CardHeader title="Shaxsiy ma’lumotlar" description="Pasport va guvohnomadagidek yozing." />
          <div className="space-y-3 px-5 pb-5">
            <Field label="Familiya, ism, otasining ismi">
              <Input value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} disabled={locked} autoComplete="name" />
            </Field>
            <Field label="Ishlaydigan shahar">
              <Select value={profile.cityId} onChange={(e) => setProfile({ ...profile, cityId: e.target.value })} disabled={locked}>
                <option value="">Tanlang</option>
                {cities.data?.allCities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.status !== "ACTIVE" ? " (tez orada)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Guvohnoma raqami">
                <Input value={profile.licenseNumber} onChange={(e) => setProfile({ ...profile, licenseNumber: e.target.value.toUpperCase() })} disabled={locked} placeholder="AA1234567" />
              </Field>
              <Field label="Amal qilish muddati">
                <Input type="date" value={profile.licenseExpiry} onChange={(e) => setProfile({ ...profile, licenseExpiry: e.target.value })} disabled={locked} />
              </Field>
            </div>
            {!locked && (
              <Button block onClick={() => saveProfile.mutate()} loading={saveProfile.isPending} disabled={!profile.fullName || !profile.cityId || !profile.licenseNumber || !profile.licenseExpiry}>
                Saqlash
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Avtomobil"
            description="Faqat o‘zingiz haydaydigan mashina."
            action={d.vehicle && <Badge tone={d.vehicle.status === "APPROVED" ? "success" : d.vehicle.status === "REJECTED" ? "danger" : "warn"}>{d.vehicle.status === "APPROVED" ? "Tasdiqlangan" : d.vehicle.status === "REJECTED" ? "Rad etilgan" : "Tekshiruvda"}</Badge>}
          />
          <div className="space-y-3 px-5 pb-5">
            {d.vehicle && <Plate plate={d.vehicle.plateNumber} />}
            {d.vehicle?.rejectionReason && <Alert tone="danger">Izoh: {d.vehicle.rejectionReason}</Alert>}
            <Field label="Davlat raqami" hint="Masalan: 70 A 123 BC">
              <Input value={vehicle.plateNumber} onChange={(e) => setVehicle({ ...vehicle, plateNumber: e.target.value.toUpperCase() })} disabled={locked} className="font-mono" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Marka">
                <Input value={vehicle.make} onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })} disabled={locked} />
              </Field>
              <Field label="Model">
                <Input value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} disabled={locked} placeholder="Cobalt" />
              </Field>
              <Field label="Rangi">
                <Input value={vehicle.color} onChange={(e) => setVehicle({ ...vehicle, color: e.target.value })} disabled={locked} placeholder="Oq" />
              </Field>
              <Field label="Yili">
                <Input type="number" inputMode="numeric" value={vehicle.year} onChange={(e) => setVehicle({ ...vehicle, year: Number(e.target.value) })} disabled={locked} />
              </Field>
            </div>
            <Field label="Tarif sinfi">
              <Select value={vehicle.vehicleClass} onChange={(e) => setVehicle({ ...vehicle, vehicleClass: e.target.value })} disabled={locked}>
                <option value="ECONOMY">Ekonom</option>
                <option value="COMFORT">Komfort</option>
              </Select>
            </Field>
            {!locked && (
              <Button block variant="outline" onClick={() => saveVehicle.mutate()} loading={saveVehicle.isPending} disabled={!vehicle.plateNumber || !vehicle.model || !vehicle.color}>
                Avtomobilni saqlash
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Hujjatlar" description="JPG, PNG yoki PDF, 6 MB gacha. Fayllar faqat tekshiruvchilarga ko‘rinadi." />
          <ul className="divide-y divide-border border-t border-border">
            {DOC_TYPES.map(([type, label, required]) => (
              <DocRow key={type} type={type} label={label} required={required} doc={latest.get(type)} locked={locked} onUploaded={refresh} />
            ))}
          </ul>
        </Card>

        {!locked && (
          <Button size="lg" variant="accent" block onClick={() => submit.mutate()} loading={submit.isPending}>
            Arizani tekshiruvga yuborish
          </Button>
        )}
        {!locked && d.missingDocuments.length > 0 && <p className="text-center text-xs text-muted">Yetishmayapti: {d.missingDocuments.map((m) => m.label).join(", ")}</p>}
      </div>
    </PageShell>
  );
}

function DocRow({ type, label, required, doc, locked, onUploaded }: { type: string; label: string; required: boolean; doc?: Doc; locked: boolean; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set("type", type);
      fd.set("file", file);
      return api("/driver/documents", { body: fd });
    },
    onSuccess: () => (toast.success("Hujjat yuklandi."), onUploaded()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const r = doc ? REVIEW[doc.status] : null;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {label}
          {!required && <span className="ml-1 text-xs text-muted">(ixtiyoriy)</span>}
        </p>
        {r ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs">
            <Badge tone={r.tone}>
              <r.I className="size-3" /> {r.t}
            </Badge>
            {doc?.rejectionReason && <span className="text-danger">{doc.rejectionReason}</span>}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">Yuklanmagan</p>
        )}
      </div>
      {(!locked || doc?.status === "REJECTED") && doc?.status !== "APPROVED" && (
        <>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          <Button size="sm" variant={doc ? "ghost" : "outline"} onClick={() => input.current?.click()} loading={upload.isPending}>
            <FileUp className="size-4" /> {doc ? "Qayta" : "Yuklash"}
          </Button>
        </>
      )}
    </li>
  );
}
