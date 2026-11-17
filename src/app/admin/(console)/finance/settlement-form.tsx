"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Money, Select } from "@/components/ui";
import { api, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";

export function SettlementForm({ drivers }: { drivers: { id: string; name: string; outstanding: number }[] }) {
  const router = useRouter();
  const [driverId, setDriverId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH_AT_OFFICE");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = drivers.find((d) => d.id === driverId);
  return (
    <Card className="space-y-3 p-5">
      <p className="font-semibold">Komissiya to‘lovini qayd etish</p>
      <p className="text-xs text-muted">Faqat pul haqiqatda kelib tushganidan keyin kiriting. Yozuvni o‘chirib bo‘lmaydi.</p>
      <Field label="Haydovchi">
        <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Tanlang</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {d.outstanding.toLocaleString("ru-RU")} so‘m
            </option>
          ))}
        </Select>
      </Field>
      {selected && (
        <p className="text-sm">
          Qarz: <Money amount={selected.outstanding} size="sm" />{" "}
          <button className="text-accent underline" onClick={() => setAmount(String(selected.outstanding))}>
            to‘liq
          </button>
        </p>
      )}
      <Field label="Summa (so‘m)">
        <Input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Usul">
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="CASH_AT_OFFICE">Ofisda naqd</option>
          <option value="BANK_TRANSFER">Bank o‘tkazmasi</option>
          <option value="CARD_TRANSFER">Karta o‘tkazmasi</option>
        </Select>
      </Field>
      <Field label="Kvitansiya / tranzaksiya raqami">
        <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
      </Field>
      <Button
        block
        loading={saving}
        disabled={!driverId || !(Number(amount) > 0)}
        onClick={async () => {
          setSaving(true);
          try {
            await api("/admin/settlements", { body: { driverId, amount: Math.round(Number(amount)), method, reference: reference || null }, idempotencyKey: newIdempotencyKey() });
            toast.success("To‘lov qayd etildi.");
            setAmount("");
            setReference("");
            router.refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        Qayd etish
      </Button>
    </Card>
  );
}
