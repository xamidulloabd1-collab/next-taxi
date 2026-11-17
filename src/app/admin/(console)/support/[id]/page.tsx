import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { hasPermission } from "@/lib/permissions";
import { Forbidden, PageHeader } from "@/components/admin/ui";
import { Badge, Card, cn } from "@/components/ui";
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from "@/features/support/service";
import { formatDateTimeUz } from "@/lib/time";
import { formatUzPhone } from "@/lib/phone";
import { ReplyBox } from "./reply-box";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await staffPage("support.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await db().supportTicket.findUnique({ where: { id }, include: { user: true, ride: { select: { id: true, code: true } }, messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } } } });
  if (!t) notFound();
  return (
    <>
      <PageHeader title={t.subject} description={`${TICKET_CATEGORY_LABELS[t.category]} · ${t.user.fullName ?? "—"} · ${formatUzPhone(t.user.phone)}`} actions={<Badge tone={t.status === "OPEN" ? "warn" : "neutral"}>{TICKET_STATUS_LABELS[t.status]}</Badge>} />
      {t.ride && (
        <p className="mb-4 text-sm">
          Bog‘liq buyurtma:{" "}
          <Link className="font-mono underline" href={`/admin/rides/${t.ride.id}`}>
            {t.ride.code}
          </Link>
        </p>
      )}
      <Card className="max-w-3xl space-y-3 p-5">
        {t.messages.map((m) => (
          <div key={m.id} className={cn("max-w-[80%] rounded-xl px-4 py-2.5 text-sm", m.isStaff ? "ml-auto bg-primary text-primary-fg" : "bg-surface-2")}>
            <p className="mb-0.5 text-[11px] opacity-70">
              {m.isStaff ? `Operator: ${m.author.fullName ?? ""}` : "Foydalanuvchi"} · {formatDateTimeUz(m.createdAt)}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
        {hasPermission(ctx, "support.manage") && <ReplyBox ticketId={t.id} status={t.status} />}
      </Card>
    </>
  );
}
