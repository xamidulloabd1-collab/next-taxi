import Link from "next/link";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { hasPermission } from "@/lib/permissions";
import { Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { ApiAction } from "@/components/admin/actions";
import { Badge } from "@/components/ui";
import { formatDateTimeUz } from "@/lib/time";
import { formatUzPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
const SEV = { LOW: "neutral", MEDIUM: "warn", HIGH: "danger", CRITICAL: "danger" } as const;
const STATUS = { OPEN: "Ochiq", INVESTIGATING: "Tekshirilmoqda", RESOLVED: "Hal qilindi" } as const;

export default async function IncidentsPage() {
  const ctx = await staffPage("incidents.view");
  if (!ctx) return <Forbidden />;
  const rows = await db().safetyIncident.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100, include: { reportedBy: true, ride: { select: { id: true, code: true } } } });
  const canManage = hasPermission(ctx, "incidents.manage");
  return (
    <>
      <PageHeader title="Xavfsizlik hodisalari" description="SOS va xavfsizlik xabarlari. Kritik hodisalarga darhol javob bering: qo‘ng‘iroq qiling, kerak bo‘lsa 112 ga xabar bering." />
      <Table head={["Vaqt", "Daraja", "Kimdan", "Tavsif", "Buyurtma", "Holat", ""]} empty="Hodisa yo‘q">
        {rows.map((i) => (
          <tr key={i.id}>
            <Td className="text-muted">{formatDateTimeUz(i.createdAt)}</Td>
            <Td>
              <Badge tone={SEV[i.severity]}>{i.severity}</Badge>
            </Td>
            <Td>
              {i.reportedBy.fullName ?? "—"}
              <span className="block text-xs text-muted num">
                {i.reporterRole === "DRIVER" ? "Haydovchi" : "Yo‘lovchi"} · {formatUzPhone(i.reportedBy.phone)}
              </span>
            </Td>
            <Td className="max-w-xs">
              {i.description}
              {i.lat != null && i.lng != null && (
                <a className="block text-xs text-accent underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=17/${i.lat}/${i.lng}`}>
                  Joylashuv
                </a>
              )}
              {i.resolution && <span className="block text-xs text-muted">Yechim: {i.resolution}</span>}
            </Td>
            <Td>{i.ride ? <Link className="font-mono underline" href={`/admin/rides/${i.ride.id}`}>{i.ride.code}</Link> : "—"}</Td>
            <Td>{STATUS[i.status]}</Td>
            <Td>
              {canManage && i.status !== "RESOLVED" && (
                <div className="flex gap-1.5">
                  {i.status === "OPEN" && <ApiAction label="Tekshiruvga olish" method="PATCH" endpoint={`/admin/incidents/${i.id}`} body={{ status: "INVESTIGATING" }} />}
                  <ApiAction label="Hal qilish" method="PATCH" endpoint={`/admin/incidents/${i.id}`} body={{ status: "RESOLVED" }} reason={{ label: "Nima qilindi", required: true, field: "resolution" }} />
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
