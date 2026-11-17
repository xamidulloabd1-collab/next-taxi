"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, MessageSquarePlus } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { fmtDateTime } from "@/features/client/types";

interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  createdAt: string;
  messages: { id: string; body: string; isStaff: boolean; createdAt: string }[];
}

const STATUS: Record<Ticket["status"], { label: string; tone: "success" | "warn" | "neutral" }> = {
  OPEN: { label: "Ochiq", tone: "warn" },
  IN_PROGRESS: { label: "Ko‘rib chiqilmoqda", tone: "warn" },
  RESOLVED: { label: "Hal qilindi", tone: "success" },
  CLOSED: { label: "Yopildi", tone: "neutral" },
};

const CATEGORIES = [
  ["RIDE", "Safar bo‘yicha"],
  ["PAYMENT", "To‘lov"],
  ["ACCOUNT", "Hisob"],
  ["DRIVER_APPLICATION", "Haydovchi arizasi"],
  ["SAFETY", "Xavfsizlik"],
  ["OTHER", "Boshqa"],
] as const;

// Mirrors the server schema; the server re-validates everything.
const ticketForm = z.object({
  category: z.enum(["RIDE", "PAYMENT", "ACCOUNT", "DRIVER_APPLICATION", "SAFETY", "OTHER"]),
  subject: z.string().trim().min(3, "Mavzu kamida 3 ta belgidan iborat bo‘lsin").max(120),
  message: z.string().trim().min(5, "Batafsilroq yozing (kamida 5 ta belgi)").max(2000),
});
type TicketForm = z.infer<typeof ticketForm>;

export function SupportCenter({ app, rideId }: { app: "passenger" | "driver"; rideId?: string }) {
  const qc = useQueryClient();
  const tickets = useQuery({ queryKey: [app, "tickets"], queryFn: () => api<{ tickets: Ticket[] }>(`/${app}/support/tickets`) });
  const [composing, setComposing] = useState(Boolean(rideId));
  const [open, setOpen] = useState<string | null>(null);
  const form = useForm<TicketForm>({ resolver: zodResolver(ticketForm), defaultValues: { category: rideId ? "RIDE" : "OTHER", subject: "", message: "" } });
  const [reply, setReply] = useState("");

  const create = useMutation({
    mutationFn: (values: TicketForm) => api(`/${app}/support/tickets`, { body: { ...values, rideId: rideId ?? null } }),
    onSuccess: () => {
      toast.success("Murojaatingiz yuborildi.");
      setComposing(false);
      form.reset({ category: "OTHER", subject: "", message: "" });
      void qc.invalidateQueries({ queryKey: [app, "tickets"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: (id: string) => api(`/${app}/support/tickets/${id}/messages`, { body: { body: reply } }),
    onSuccess: () => {
      setReply("");
      void qc.invalidateQueries({ queryKey: [app, "tickets"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      {!composing && (
        <Button block variant="outline" onClick={() => setComposing(true)}>
          <MessageSquarePlus className="size-4" /> Yangi murojaat
        </Button>
      )}
      {composing && (
        <Card className="p-4">
          <form className="space-y-3" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
            <Field label="Mavzu turi" htmlFor="t-category">
              <Select id="t-category" {...form.register("category")}>
                {CATEGORIES.filter(([v]) => app === "driver" || v !== "DRIVER_APPLICATION").map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Qisqacha mavzu" htmlFor="t-subject" error={form.formState.errors.subject?.message}>
              <Input id="t-subject" maxLength={120} placeholder="Masalan: Haydovchi kech keldi" {...form.register("subject")} />
            </Field>
            <Field label="Batafsil" htmlFor="t-message" error={form.formState.errors.message?.message}>
              <Textarea id="t-message" maxLength={2000} placeholder="Nima bo‘lganini yozing" {...form.register("message")} />
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" block onClick={() => setComposing(false)}>
                Bekor
              </Button>
              <Button type="submit" block loading={create.isPending}>
                Yuborish
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tickets.isLoading ? (
        <Skeleton className="h-24" />
      ) : !tickets.data?.tickets.length ? (
        !composing && <EmptyState icon={<LifeBuoy className="size-5" />} title="Murojaatlar yo‘q" description="Savol yoki muammo bo‘lsa, yangi murojaat yozing. Operator shu yerda javob beradi." />
      ) : (
        <ul className="space-y-2">
          {tickets.data.tickets.map((t) => (
            <li key={t.id}>
              <Card className="overflow-hidden">
                <button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.subject}</span>
                    <span className="text-xs text-muted">{fmtDateTime(t.createdAt)}</span>
                  </span>
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                </button>
                {open === t.id && (
                  <div className="space-y-2 border-t border-border bg-surface-2/50 px-4 py-3">
                    {t.messages.map((m) => (
                      <div key={m.id} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.isStaff ? "bg-surface" : "ml-auto bg-primary text-primary-fg")}>
                        {m.isStaff && <span className="mb-0.5 block text-[11px] font-semibold text-accent">Operator</span>}
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                    ))}
                    {t.status !== "CLOSED" && (
                      <div className="flex gap-2 pt-1">
                        <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Javob yozing" maxLength={2000} />
                        <Button onClick={() => send.mutate(t.id)} disabled={!reply.trim()} loading={send.isPending}>
                          Yuborish
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
