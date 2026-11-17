"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";

export function ReplyBox({ ticketId, status }: { ticketId: string; status: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [next, setNext] = useState(status === "OPEN" ? "IN_PROGRESS" : status);
  const [loading, setLoading] = useState(false);
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Javob yozing — foydalanuvchi ilovada ko‘radi" maxLength={2000} />
      <div className="flex flex-wrap gap-2">
        <Select value={next} onChange={(e) => setNext(e.target.value)} className="w-auto">
          <option value="IN_PROGRESS">Ko‘rib chiqilmoqda</option>
          <option value="RESOLVED">Hal qilindi</option>
          <option value="CLOSED">Yopish</option>
        </Select>
        <Button
          loading={loading}
          disabled={!body.trim()}
          onClick={async () => {
            setLoading(true);
            try {
              await api(`/admin/support/${ticketId}/reply`, { body: { body, status: next } });
              setBody("");
              toast.success("Javob yuborildi.");
              router.refresh();
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setLoading(false);
            }
          }}
        >
          Javob yuborish
        </Button>
      </div>
    </div>
  );
}
