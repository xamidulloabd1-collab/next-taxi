"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapView } from "@/components/maps/map-view";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";

type Polygon = { type: "Polygon"; coordinates: [number, number][][] };
interface CityData {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  centerLat: number | null;
  centerLng: number | null;
  defaultZoom: number;
  operatingHoursStart: string;
  operatingHoursEnd: string;
  searchRadiusMeters: number;
  offerTimeoutSeconds: number;
  offerBatchSize: number;
  maxOffersPerRide: number;
  searchTimeoutSeconds: number;
  maxDriverDebt: number;
}
interface Zone {
  id: string;
  name: string;
  isActive: boolean;
  note: string | null;
  boundary: Polygon;
  km2: number | null;
}

export function CityEditor({ city, zones, canEdit }: { city: CityData; zones: Zone[]; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState(city);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; name: string; isActive: boolean; note: string; points: [number, number][] } | null>(null);
  const [geojson, setGeojson] = useState("");
  const center = city.centerLat != null && city.centerLng != null ? { lat: city.centerLat, lng: city.centerLng } : { lat: 41.3, lng: 64.5 };

  async function saveCity(patch: Partial<CityData>) {
    setSaving(true);
    try {
      await api(`/admin/cities/${city.id}`, { method: "PATCH", body: patch });
      toast.success("Shahar sozlamalari saqlandi.");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveZone() {
    if (!editing) return;
    let boundary: Polygon;
    if (geojson.trim()) {
      try {
        const parsed = JSON.parse(geojson) as { type: string; geometry?: Polygon; coordinates?: [number, number][][] };
        boundary = parsed.type === "Feature" ? parsed.geometry! : (parsed as Polygon);
      } catch {
        return toast.error("GeoJSON formati noto‘g‘ri.");
      }
    } else {
      if (editing.points.length < 3) return toast.error("Kamida 3 ta nuqta belgilang.");
      boundary = { type: "Polygon", coordinates: [[...editing.points, editing.points[0]!]] };
    }
    try {
      await api("/admin/zones", { body: { id: editing.id, cityId: city.id, name: editing.name, isActive: editing.isActive, note: editing.note || null, boundary } });
      toast.success("Hudud saqlandi.");
      setEditing(null);
      setGeojson("");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const num = (k: keyof CityData) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value === "" ? null : Number(e.target.value) });

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      <div className="space-y-3">
        <div className="relative h-[55vh] overflow-hidden rounded-2xl border border-border">
          <MapView
            controls
            className="absolute inset-0"
            center={center}
            zoom={city.centerLat != null ? city.defaultZoom : 5.5}
            zones={zones.filter((z) => z.isActive && z.id !== editing?.id).map((z) => z.boundary)}
            draft={editing?.points ?? null}
            onMapClick={editing ? (p) => setEditing({ ...editing, points: [...editing.points, [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]] }) : undefined}
          />
        </div>
        {editing && (
          <p className="text-sm text-muted">
            Xaritada chegara nuqtalarini ketma-ket bosing ({editing.points.length} ta).{" "}
            <button className="font-medium text-fg underline" onClick={() => setEditing({ ...editing, points: editing.points.slice(0, -1) })}>
              Oxirgisini o‘chirish
            </button>
          </p>
        )}
        <Card>
          <CardHeader
            title="Xizmat hududlari"
            description="Olib ketish va borish nuqtalari faol hudud ichida bo‘lishi kerak."
            action={canEdit && !editing && <Button size="sm" variant="outline" onClick={() => setEditing({ name: "", isActive: true, note: "", points: [] })}>Yangi hudud</Button>}
          />
          <ul className="divide-y divide-border border-t border-border">
            {zones.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {z.name} {z.isActive ? <Badge tone="success">Faol</Badge> : <Badge>O‘chirilgan</Badge>}
                  </p>
                  <p className="text-xs text-muted num">{z.km2 != null ? `${z.km2.toFixed(1)} km²` : ""} · {z.boundary.coordinates[0]!.length - 1} ta nuqta</p>
                  {z.note && <p className="mt-1 text-xs text-warn">{z.note}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: z.id, name: z.name, isActive: z.isActive, note: z.note ?? "", points: z.boundary.coordinates[0]!.slice(0, -1) })}>
                      Tahrirlash
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {zones.length === 0 && <li className="px-5 py-6 text-sm text-muted">Hudud yo‘q.</li>}
          </ul>
        </Card>
      </div>

      <div className="space-y-4">
        {editing && (
          <Card className="space-y-3 p-5">
            <p className="font-semibold">{editing.id ? "Hududni tahrirlash" : "Yangi hudud"}</p>
            <Field label="Nomi">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Izoh (manba, tasdiqlash holati)">
              <Textarea value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} className="min-h-16" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Faol
            </label>
            <Field label="Yoki GeoJSON Polygon joylashtiring" hint="Masalan, OpenStreetMap’dan eksport qilingan chegara. To‘ldirilsa, xaritadagi nuqtalar e’tiborga olinmaydi.">
              <Textarea value={geojson} onChange={(e) => setGeojson(e.target.value)} className="min-h-20 font-mono text-xs" placeholder='{"type":"Polygon","coordinates":[[[66.2,38.6],…]]}' />
            </Field>
            <div className="flex gap-2">
              <Button variant="ghost" block onClick={() => (setEditing(null), setGeojson(""))}>
                Bekor
              </Button>
              <Button block onClick={() => void saveZone()} disabled={!editing.name.trim()}>
                Saqlash
              </Button>
            </div>
          </Card>
        )}

        <Card className="space-y-3 p-5">
          <p className="font-semibold">Shahar sozlamalari</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Markaz kenglik">
              <Input type="number" step="0.00001" value={form.centerLat ?? ""} onChange={num("centerLat")} disabled={!canEdit} />
            </Field>
            <Field label="Markaz uzunlik">
              <Input type="number" step="0.00001" value={form.centerLng ?? ""} onChange={num("centerLng")} disabled={!canEdit} />
            </Field>
            <Field label="Ish boshlanishi">
              <Input type="time" value={form.operatingHoursStart} onChange={(e) => setForm({ ...form, operatingHoursStart: e.target.value })} disabled={!canEdit} />
            </Field>
            <Field label="Ish tugashi">
              <Input type="time" value={form.operatingHoursEnd} onChange={(e) => setForm({ ...form, operatingHoursEnd: e.target.value })} disabled={!canEdit} />
            </Field>
            <Field label="Qidiruv radiusi (m)">
              <Input type="number" value={form.searchRadiusMeters} onChange={num("searchRadiusMeters")} disabled={!canEdit} />
            </Field>
            <Field label="Taklif muddati (s)">
              <Input type="number" value={form.offerTimeoutSeconds} onChange={num("offerTimeoutSeconds")} disabled={!canEdit} />
            </Field>
            <Field label="Bir vaqtda takliflar">
              <Input type="number" min={1} max={5} value={form.offerBatchSize} onChange={num("offerBatchSize")} disabled={!canEdit} />
            </Field>
            <Field label="Maks. takliflar">
              <Input type="number" value={form.maxOffersPerRide} onChange={num("maxOffersPerRide")} disabled={!canEdit} />
            </Field>
            <Field label="Qidiruv vaqti (s)">
              <Input type="number" value={form.searchTimeoutSeconds} onChange={num("searchTimeoutSeconds")} disabled={!canEdit} />
            </Field>
            <Field label="Maks. qarz (so‘m)">
              <Input type="number" value={form.maxDriverDebt} onChange={num("maxDriverDebt")} disabled={!canEdit} />
            </Field>
          </div>
          <p className="text-xs text-muted">Ish vaqti boshlanishi va tugashi bir xil bo‘lsa — 24 soat.</p>
          {canEdit && (
            <Button
              block
              loading={saving}
              onClick={() => {
                const { id: _id, status: _s, ...patch } = form;
                void saveCity(patch);
              }}
            >
              Sozlamalarni saqlash
            </Button>
          )}
        </Card>

        {canEdit && (
          <Card className="space-y-3 p-5">
            <p className="font-semibold">Holat</p>
            {city.status === "ACTIVE" ? (
              <>
                <Alert tone="success">Shahar faol: yo‘lovchilar buyurtma bera oladi.</Alert>
                <Field label="O‘chirish">
                  <Select defaultValue="" onChange={(e) => e.target.value === "off" && void saveCity({ status: "INACTIVE" })}>
                    <option value="">Faol qoldirish</option>
                    <option value="off">Xizmatni to‘xtatish</option>
                  </Select>
                </Field>
              </>
            ) : (
              <Button variant="accent" block loading={saving} onClick={() => void saveCity({ status: "ACTIVE" })}>
                Shaharni faollashtirish
              </Button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
