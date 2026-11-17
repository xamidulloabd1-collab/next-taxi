"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";

export function SettingRow({ k, description, value, isDefault }: { k: string; description: string; value: unknown; isDefault: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(Array.isArray(value) ? (value as string[]).join("; ") : String(value ?? ""));
  const [saving, setSaving] = useState(false);
  async function save() {
    const parsed = Array.isArray(value) ? text.split(";").map((s) => s.trim()).filter(Boolean) : typeof value === "number" ? Number(text) : text;
    setSaving(true);
    try {
      await api("/admin/settings", { method: "PATCH", body: { key: k, value: parsed } });
      toast.success("Saqlandi.");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <li className="space-y-2 px-5 py-3">
      <p className="text-sm">
        {description} {isDefault && <Badge>standart</Badge>}
      </p>
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} className="h-10" aria-label={description} />
        <Button size="sm" className="h-10" loading={saving} onClick={() => void save()}>
          Saqlash
        </Button>
      </div>
    </li>
  );
}

export function StaffForm({ cities }: { cities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("SUPPORT_OPERATOR");
  const [cityId, setCityId] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input placeholder="Telefon: 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Input placeholder="F.I.Sh." value={name} onChange={(e) => setName(e.target.value)} />
      <Select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="SUPPORT_OPERATOR">Qo‘llab-quvvatlash operatori</option>
        <option value="CITY_MANAGER">Shahar menejeri</option>
        <option value="FINANCE_MANAGER">Moliya menejeri</option>
        <option value="COMPLIANCE_REVIEWER">Hujjat tekshiruvchi</option>
        <option value="SUPER_ADMIN">Bosh administrator</option>
      </Select>
      <Select value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={role !== "CITY_MANAGER"}>
        <option value="">Barcha shaharlar</option>
        {cities.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button
        className="sm:col-span-2"
        loading={saving}
        disabled={phone.replace(/\D/g, "").length < 9}
        onClick={async () => {
          setSaving(true);
          try {
            await api("/admin/staff", { body: { phone, role, cityId: role === "CITY_MANAGER" && cityId ? cityId : null, fullName: name || null } });
            toast.success("Rol berildi. Xodim shu raqam bilan kirishi mumkin.");
            setPhone("");
            setName("");
            router.refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        Rol berish
      </Button>
    </div>
  );
}
