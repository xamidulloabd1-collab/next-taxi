"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Money, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";

interface T {
  vehicleClass: string;
  name: string;
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  roundingStep: number;
  commissionBps: number;
  quoteTtlSeconds: number;
}

const EMPTY: T = { vehicleClass: "ECONOMY", name: "Ekonom", baseFare: 5000, perKm: 1500, perMinute: 200, minimumFare: 8000, roundingStep: 500, commissionBps: 1000, quoteTtlSeconds: 300 };

export function TariffForm({ cities }: { cities: { id: string; name: string; active: T[] }[] }) {
  const router = useRouter();
  const [cityId, setCityId] = useState(cities[0]?.id ?? "");
  const [t, setT] = useState<T>(() => cities[0]?.active[0] ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const load = (cid: string, cls: string) => setT(cities.find((c) => c.id === cid)?.active.find((a) => a.vehicleClass === cls) ?? { ...EMPTY, vehicleClass: cls, name: cls === "COMFORT" ? "Komfort" : "Ekonom" });
  // Live preview with the same formula as the server (4 km, 10 min).
  const preview = useMemo(() => {
    const sub = t.baseFare + Math.round((t.perKm * 4000) / 1000) + Math.round((t.perMinute * 600) / 60);
    const fare = Math.ceil(Math.max(sub, t.minimumFare) / Math.max(1, t.roundingStep)) * Math.max(1, t.roundingStep);
    return { fare, commission: Math.round((fare * t.commissionBps) / 10000) };
  }, [t]);
  const n = (k: keyof T) => (e: React.ChangeEvent<HTMLInputElement>) => setT({ ...t, [k]: Number(e.target.value) });

  return (
    <Card className="p-5">
      <p className="font-semibold">Yangi tarif versiyasini e’lon qilish</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Shahar">
          <Select value={cityId} onChange={(e) => (setCityId(e.target.value), load(e.target.value, t.vehicleClass))}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sinf">
          <Select value={t.vehicleClass} onChange={(e) => load(cityId, e.target.value)}>
            <option value="ECONOMY">Ekonom</option>
            <option value="COMFORT">Komfort</option>
          </Select>
        </Field>
        <Field label="Nomi">
          <Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </Field>
        <Field label="Boshlang‘ich (so‘m)"><Input type="number" value={t.baseFare} onChange={n("baseFare")} /></Field>
        <Field label="1 km (so‘m)"><Input type="number" value={t.perKm} onChange={n("perKm")} /></Field>
        <Field label="1 daqiqa (so‘m)"><Input type="number" value={t.perMinute} onChange={n("perMinute")} /></Field>
        <Field label="Minimal narx"><Input type="number" value={t.minimumFare} onChange={n("minimumFare")} /></Field>
        <Field label="Yaxlitlash qadami"><Input type="number" value={t.roundingStep} onChange={n("roundingStep")} /></Field>
        <Field label="Komissiya (bazis punkt)" hint="1000 = 10%"><Input type="number" value={t.commissionBps} onChange={n("commissionBps")} /></Field>
        <Field label="Narx amal qilishi (s)"><Input type="number" value={t.quoteTtlSeconds} onChange={n("quoteTtlSeconds")} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
        <span>
          Namuna: 4 km, 10 daqiqa → <Money amount={preview.fare} size="sm" />, komissiya <Money amount={preview.commission} size="sm" />
        </span>
        <Button
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api("/admin/tariffs", { body: { ...t, cityId } });
              toast.success("Yangi tarif versiyasi e’lon qilindi.");
              router.refresh();
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Versiyani e’lon qilish
        </Button>
      </div>
    </Card>
  );
}
