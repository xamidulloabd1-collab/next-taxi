import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { hasPermission } from "@/lib/permissions";
import { Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { ApiAction } from "@/components/admin/actions";
import { Alert, Badge, Card, CardHeader, Money, Plate } from "@/components/ui";
import { DOCUMENT_LABELS, REQUIRED_DOCUMENTS } from "@/features/drivers/service";
import { driverOutstandingCommission } from "@/features/payments/service";
import { RIDE_STATUS_LABELS } from "@/features/rides/state-machine";
import { formatDateTimeUz } from "@/lib/time";
import { formatUzPhone } from "@/lib/phone";
import { statusTone } from "@/features/client/types";
import { DRIVER_STATUS } from "@/features/admin/labels";

export const dynamic = "force-dynamic";

const REVIEW_TONE = { PENDING: "warn", APPROVED: "success", REJECTED: "danger" } as const;
const REVIEW_LABEL = { PENDING: "Kutmoqda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan" } as const;

export default async function DriverDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await staffPage("drivers.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await db().driverProfile.findUnique({
    where: { userId: id },
    include: { user: true, city: true, documents: { orderBy: { createdAt: "desc" } }, vehicles: { include: { vehicle: true }, orderBy: { createdAt: "desc" } }, location: true },
  });
  if (!d) notFound();
  const [rides, outstanding] = await Promise.all([
    db().ride.findMany({ where: { driverId: id }, orderBy: { requestedAt: "desc" }, take: 15 }),
    driverOutstandingCommission(id),
  ]);
  const canVerify = hasPermission(ctx, "drivers.verify");
  const canManage = hasPermission(ctx, "drivers.manage");
  const canDocs = hasPermission(ctx, "documents.view");
  const canBlock = hasPermission(ctx, "passengers.manage");
  const active = d.vehicles.find((v) => v.isActive)?.vehicle;
  const latest = new Map<string, (typeof d.documents)[number]>();
  for (const doc of d.documents) if (!latest.has(doc.type)) latest.set(doc.type, doc);
  const allApproved = REQUIRED_DOCUMENTS.every((t) => latest.get(t)?.status === "APPROVED") && active?.status === "APPROVED";

  return (
    <>
      <PageHeader
        title={d.user.fullName ?? "Ism kiritilmagan"}
        description={`${formatUzPhone(d.user.phone)} · ${d.city?.name ?? "shahar tanlanmagan"} · ro‘yxatdan o‘tgan ${formatDateTimeUz(d.createdAt).slice(0, 10)}`}
        actions={
          <>
            {canVerify && d.status === "PENDING_REVIEW" && (
              <>
                <ApiAction label="Tasdiqlash" variant="accent" endpoint={`/admin/drivers/${id}/decision`} body={{ decision: "APPROVE" }} confirm={allApproved ? "Haydovchi buyurtma qabul qila boshlaydi." : "Diqqat: barcha hujjatlar va avtomobil tasdiqlanmagan — server rad etadi."} success="Haydovchi tasdiqlandi." />
                <ApiAction label="Rad etish" variant="danger-outline" endpoint={`/admin/drivers/${id}/decision`} body={{ decision: "REJECT" }} reason={{ label: "Haydovchiga ko‘rinadigan sabab", required: true }} />
              </>
            )}
            {canManage && d.status === "APPROVED" && <ApiAction label="To‘xtatish" variant="danger-outline" endpoint={`/admin/drivers/${id}/suspension`} body={{ suspend: true }} reason={{ label: "To‘xtatish sababi", required: true }} />}
            {canManage && d.status === "SUSPENDED" && <ApiAction label="Qayta faollashtirish" endpoint={`/admin/drivers/${id}/suspension`} body={{ suspend: false }} confirm="Haydovchi yana buyurtma olishi mumkin bo‘ladi." />}
            {canBlock && <ApiAction label={d.user.status === "BLOCKED" ? "Blokdan chiqarish" : "Hisobni bloklash"} variant="danger-outline" endpoint={`/admin/users/${id}/block`} body={{ blocked: d.user.status !== "BLOCKED" }} reason={{ label: "Sabab", required: true }} />}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={DRIVER_STATUS[d.status].t}>{DRIVER_STATUS[d.status].l}</Badge>
        {d.user.status === "BLOCKED" && <Badge tone="danger">Hisob bloklangan</Badge>}
        <Badge tone={d.availability === "ONLINE" ? "success" : "neutral"}>{d.availability === "ONLINE" ? "Onlayn" : "Oflayn"}</Badge>
        {d.rejectionReason && <Badge tone="danger">Rad sababi: {d.rejectionReason}</Badge>}
        {d.suspendedReason && <Badge tone="danger">To‘xtatish sababi: {d.suspendedReason}</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Hujjatlar" description={canDocs ? "Har bir ko‘rish audit jurnaliga yoziladi." : "Hujjat fayllarini ko‘rish uchun ruxsat yo‘q."} />
          <ul className="divide-y divide-border border-t border-border">
            {Object.keys(DOCUMENT_LABELS).map((type) => {
              const doc = latest.get(type);
              return (
                <li key={type} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {DOCUMENT_LABELS[type as keyof typeof DOCUMENT_LABELS]}
                      {!REQUIRED_DOCUMENTS.includes(type as never) && <span className="ml-1 text-xs text-muted">(ixtiyoriy)</span>}
                    </p>
                    {doc ? <Badge tone={REVIEW_TONE[doc.status]}>{REVIEW_LABEL[doc.status]}</Badge> : <span className="text-xs text-muted">Yuklanmagan</span>}
                    {doc?.rejectionReason && <span className="ml-2 text-xs text-danger">{doc.rejectionReason}</span>}
                  </div>
                  {doc && (
                    <div className="flex gap-1.5">
                      {canDocs && (
                        <a href={`/api/v1/admin/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-xl border border-border px-3 text-sm hover:bg-surface-2">
                          Ko‘rish
                        </a>
                      )}
                      {canVerify && doc.status !== "APPROVED" && <ApiAction label="Tasdiqlash" endpoint={`/admin/documents/${doc.id}/review`} body={{ status: "APPROVED" }} success="Hujjat tasdiqlandi." />}
                      {canVerify && doc.status !== "REJECTED" && <ApiAction label="Rad etish" variant="danger-outline" endpoint={`/admin/documents/${doc.id}/review`} body={{ status: "REJECTED" }} reason={{ label: "Haydovchiga ko‘rinadigan sabab", required: true }} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Avtomobil" />
            <div className="space-y-3 px-5 pb-5">
              {active ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {active.color} {active.make} {active.model}, {active.year} · {active.vehicleClass}
                    </span>
                    <Plate plate={active.plateNumber} size="sm" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={active.status === "APPROVED" ? "success" : active.status === "REJECTED" ? "danger" : "warn"}>{active.status}</Badge>
                    {canVerify && active.status !== "APPROVED" && <ApiAction label="Avtomobilni tasdiqlash" endpoint={`/admin/vehicles/${active.id}/review`} body={{ status: "APPROVED" }} />}
                    {canVerify && active.status !== "REJECTED" && <ApiAction label="Rad etish" variant="danger-outline" endpoint={`/admin/vehicles/${active.id}/review`} body={{ status: "REJECTED" }} reason={{ label: "Sabab", required: true }} />}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">Avtomobil kiritilmagan.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Profil va moliya" />
            <dl className="grid grid-cols-2 gap-y-2 px-5 pb-5 text-sm">
              <dt className="text-muted">Guvohnoma</dt>
              <dd className="font-mono">{d.licenseNumber ?? "—"}</dd>
              <dt className="text-muted">Amal qiladi</dt>
              <dd>{d.licenseExpiry ? d.licenseExpiry.toISOString().slice(0, 10) : "—"}</dd>
              <dt className="text-muted">Reyting</dt>
              <dd className="num">{d.ratingCount ? `${(d.ratingSum / d.ratingCount).toFixed(1)} (${d.ratingCount})` : "—"}</dd>
              <dt className="text-muted">Komissiya qarzi</dt>
              <dd>
                <Money amount={outstanding} size="sm" />
              </dd>
              <dt className="text-muted">So‘nggi GPS</dt>
              <dd>{d.location ? formatDateTimeUz(d.location.recordedAt) : "—"}</dd>
            </dl>
          </Card>
          {!allApproved && d.status === "PENDING_REVIEW" && <Alert tone="warn">Tasdiqlashdan oldin barcha majburiy hujjatlar va avtomobilni tasdiqlang.</Alert>}
        </div>
      </div>

      <h2 className="mt-8 mb-3 font-semibold">So‘nggi safarlar</h2>
      <Table head={["Kod", "Vaqt", "Holat", "Narx"]} empty="Safarlar yo‘q">
        {rides.map((r) => (
          <tr key={r.id}>
            <Td>
              <Link href={`/admin/rides/${r.id}`} className="font-mono hover:underline">
                {r.code}
              </Link>
            </Td>
            <Td className="text-muted">{formatDateTimeUz(r.requestedAt)}</Td>
            <Td>
              <Badge tone={statusTone(r.status)}>{RIDE_STATUS_LABELS[r.status]}</Badge>
            </Td>
            <Td>
              <Money amount={r.finalFare ?? r.quotedFare} size="sm" />
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
