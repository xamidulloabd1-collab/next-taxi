import Link from "next/link";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { formatDateTimeUz } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function VerificationQueue() {
  const ctx = await staffPage("drivers.verify");
  if (!ctx) return <Forbidden />;
  const [drivers, docs, vehicles] = await Promise.all([
    db().driverProfile.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { updatedAt: "asc" }, include: { user: true, city: true, documents: true } }),
    db().driverDocument.count({ where: { status: "PENDING" } }),
    db().vehicle.count({ where: { status: "PENDING_REVIEW" } }),
  ]);
  return (
    <>
      <PageHeader title="Tekshiruv navbati" description={`${drivers.length} ta ariza · ${docs} ta hujjat va ${vehicles} ta avtomobil tekshirilishi kerak. Eng eski ariza birinchi.`} />
      <Table head={["Haydovchi", "Shahar", "Yuborilgan", "Hujjatlar", ""]} empty="Navbat bo‘sh">
        {drivers.map((d) => {
          const pending = d.documents.filter((x) => x.status === "PENDING").length;
          return (
            <tr key={d.userId}>
              <Td className="font-medium">{d.user.fullName}</Td>
              <Td>{d.city?.name ?? "—"}</Td>
              <Td className="text-muted">{formatDateTimeUz(d.updatedAt)}</Td>
              <Td>{pending ? <Badge tone="warn">{pending} ta kutmoqda</Badge> : <Badge tone="success">Ko‘rib chiqilgan</Badge>}</Td>
              <Td>
                <Link href={`/admin/drivers/${d.userId}`} className="font-semibold text-accent hover:underline">
                  Ko‘rib chiqish →
                </Link>
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
