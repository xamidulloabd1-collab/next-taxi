import Link from "next/link";
import type { TicketStatus } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { FilterTabs, Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from "@/features/support/service";
import { formatDateTimeUz } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await staffPage("support.view");
  if (!ctx) return <Forbidden />;
  const s = (await searchParams).status ?? "open";
  const where = s === "open" ? { status: { in: ["OPEN", "IN_PROGRESS"] as TicketStatus[] } } : s in TICKET_STATUS_LABELS ? { status: s as TicketStatus } : {};
  const rows = await db().supportTicket.findMany({ where, orderBy: { updatedAt: "desc" }, take: 100, include: { user: { select: { fullName: true } }, _count: { select: { messages: true } } } });
  return (
    <>
      <PageHeader title="Murojaatlar" />
      <FilterTabs base="/admin/support" current={s} options={[["open", "Ochiq"], ["RESOLVED", "Hal qilingan"], ["CLOSED", "Yopilgan"], ["all", "Hammasi"]]} />
      <Table head={["Mavzu", "Kimdan", "Turi", "Holat", "Yangilangan"]} empty="Murojaat yo‘q">
        {rows.map((t) => (
          <tr key={t.id} className="hover:bg-surface-2/50">
            <Td>
              <Link href={`/admin/support/${t.id}`} className="font-medium hover:underline">
                {t.subject}
              </Link>
              <span className="block text-xs text-muted">{t._count.messages} ta xabar</span>
            </Td>
            <Td>
              {t.user.fullName ?? "—"} <span className="text-xs text-muted">({t.app === "driver" ? "haydovchi" : "yo‘lovchi"})</span>
            </Td>
            <Td>{TICKET_CATEGORY_LABELS[t.category]}</Td>
            <Td>
              <Badge tone={t.status === "OPEN" ? "warn" : t.status === "IN_PROGRESS" ? "neutral" : "success"}>{TICKET_STATUS_LABELS[t.status]}</Badge>
            </Td>
            <Td className="text-muted">{formatDateTimeUz(t.updatedAt)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
