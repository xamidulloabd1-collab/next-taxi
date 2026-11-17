import Link from "next/link";
import type { VehicleStatus } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { hasPermission } from "@/lib/permissions";
import { FilterTabs, Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { ApiAction } from "@/components/admin/actions";
import { Badge, Plate } from "@/components/ui";

export const dynamic = "force-dynamic";
const LABEL: Record<VehicleStatus, string> = { PENDING_REVIEW: "Tekshiruvda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan", INACTIVE: "Faol emas" };

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await staffPage("vehicles.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const status = sp.status && sp.status in LABEL ? (sp.status as VehicleStatus) : undefined;
  const rows = await db().vehicle.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 150, include: { drivers: { where: { isActive: true }, include: { driver: { include: { user: true } } } }, city: true } });
  const canVerify = hasPermission(ctx, "vehicles.verify");
  return (
    <>
      <PageHeader title="Avtomobillar" />
      <FilterTabs base="/admin/vehicles" current={status ?? ""} options={[["", "Hammasi"], ...Object.entries(LABEL).map(([k, v]) => [k, v] as [string, string])]} />
      <Table head={["Raqam", "Avtomobil", "Sinf", "Haydovchi", "Holat", ""]} empty="Avtomobil yo‘q">
        {rows.map((v) => (
          <tr key={v.id}>
            <Td>
              <Plate plate={v.plateNumber} size="sm" />
            </Td>
            <Td>
              {v.color} {v.make} {v.model}, {v.year}
            </Td>
            <Td>{v.vehicleClass === "COMFORT" ? "Komfort" : "Ekonom"}</Td>
            <Td>{v.drivers[0] ? <Link className="hover:underline" href={`/admin/drivers/${v.drivers[0].driverId}`}>{v.drivers[0].driver.user.fullName}</Link> : "—"}</Td>
            <Td>
              <Badge tone={v.status === "APPROVED" ? "success" : v.status === "PENDING_REVIEW" ? "warn" : "danger"}>{LABEL[v.status]}</Badge>
            </Td>
            <Td>
              {canVerify && (
                <div className="flex gap-1.5">
                  {v.status !== "APPROVED" && <ApiAction label="Tasdiqlash" endpoint={`/admin/vehicles/${v.id}/review`} body={{ status: "APPROVED" }} />}
                  {v.status === "APPROVED" && <ApiAction label="O‘chirish" variant="danger-outline" endpoint={`/admin/vehicles/${v.id}/review`} body={{ status: "INACTIVE" }} reason={{ label: "Sabab" }} />}
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
