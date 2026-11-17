import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { hasPermission } from "@/lib/permissions";
import { Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { ApiAction } from "@/components/admin/actions";
import { Badge, Card, CardHeader, Money, Plate, RouteRail } from "@/components/ui";
import { RIDE_STATUS_LABELS } from "@/features/rides/state-machine";
import { formatDateTimeUz } from "@/lib/time";
import { statusTone, fmtDistance, fmtMinutes } from "@/features/client/types";
import { maskUzPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const OFFER_LABEL: Record<string, string> = { PENDING: "Kutilmoqda", ACCEPTED: "Qabul qilindi", REJECTED: "Rad etildi", EXPIRED: "Muddati o‘tdi", CANCELLED: "Bekor" };

export default async function RideDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await staffPage("rides.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await db().ride.findUnique({
    where: { id },
    include: {
      passenger: { select: { id: true, fullName: true, phone: true } },
      driver: { include: { user: { select: { fullName: true, phone: true } } } },
      vehicle: true,
      city: true,
      statusEvents: { orderBy: { createdAt: "asc" } },
      offers: { orderBy: { sequence: "asc" }, include: { driver: { include: { user: { select: { fullName: true } } } } } },
      payment: true,
      ledgerEntries: { orderBy: { createdAt: "asc" } },
      ratings: true,
      quote: { select: { routeProvider: true, tariffVersion: true } },
    },
  });
  if (!r) notFound();
  const canManage = hasPermission(ctx, "rides.manage");
  const terminal = ["SETTLED", "CANCELLED", "NO_DRIVER"].includes(r.status);
  return (
    <>
      <PageHeader
        title={`Buyurtma ${r.code}`}
        description={`${r.city.name} · ${formatDateTimeUz(r.requestedAt)}`}
        actions={
          canManage && !terminal ? (
            <>
              {r.status === "IN_PROGRESS" && <ApiAction label="Majburan yakunlash" endpoint={`/admin/rides/${r.id}/action`} body={{ action: "complete" }} reason={{ label: "Sabab (masalan: haydovchi telefoni o‘chdi)", required: true }} />}
              {r.status === "COMPLETED" && <ApiAction label="Naqd to‘lovni tasdiqlash" endpoint={`/admin/rides/${r.id}/action`} body={{ action: "confirm-cash" }} reason={{ label: "Asos (haydovchi bilan bog‘lanildi va h.k.)", required: true }} />}
              {r.status !== "COMPLETED" && <ApiAction label="Bekor qilish" variant="danger-outline" endpoint={`/admin/rides/${r.id}/action`} body={{ action: "cancel" }} reason={{ label: "Bekor qilish sababi", required: true }} />}
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between">
            <Badge tone={statusTone(r.status)}>{RIDE_STATUS_LABELS[r.status]}</Badge>
            <Money amount={r.finalFare ?? r.quotedFare} size="lg" />
          </div>
          <RouteRail pickup={r.pickupAddress ?? `${r.pickupLat.toFixed(5)}, ${r.pickupLng.toFixed(5)}`} dropoff={r.dropoffAddress ?? `${r.dropoffLat.toFixed(5)}, ${r.dropoffLng.toFixed(5)}`} />
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Masofa / vaqt</dt>
            <dd className="num">
              {fmtDistance(r.distanceMeters)} · {fmtMinutes(r.durationSeconds)} {r.quote.routeProvider.endsWith(":estimated") && <Badge tone="warn">taxminiy</Badge>}
            </dd>
            <dt className="text-muted">Tarif versiyasi</dt>
            <dd>
              {r.vehicleClass} · v{r.quote.tariffVersion}
            </dd>
            <dt className="text-muted">Komissiya</dt>
            <dd className="num">
              {(r.commissionBps / 100).toFixed(2)}% · <Money amount={r.commissionAmount} size="sm" />
            </dd>
            <dt className="text-muted">Haydovchiga</dt>
            <dd>
              <Money amount={r.driverEarnings} size="sm" />
            </dd>
            <dt className="text-muted">To‘lov</dt>
            <dd>{r.payment ? `${r.payment.method} · ${r.payment.status}` : "—"}</dd>
            {r.cancelReason && (
              <>
                <dt className="text-muted">Bekor qilish</dt>
                <dd>
                  {r.cancelledBy} · {r.cancelReason}
                </dd>
              </>
            )}
            {r.passengerNote && (
              <>
                <dt className="text-muted">Izoh</dt>
                <dd>{r.passengerNote}</dd>
              </>
            )}
          </dl>
        </Card>
        <Card className="space-y-4 p-5">
          <div>
            <p className="text-xs text-muted">Yo‘lovchi</p>
            <Link href={`/admin/passengers?q=${encodeURIComponent(r.passenger.phone)}`} className="font-medium hover:underline">
              {r.passenger.fullName ?? "—"}
            </Link>
            <p className="text-sm text-muted num">{maskUzPhone(r.passenger.phone)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Haydovchi</p>
            {r.driver ? (
              <>
                <Link href={`/admin/drivers/${r.driverId}`} className="font-medium hover:underline">
                  {r.driver.user.fullName}
                </Link>
                <p className="text-sm text-muted num">{maskUzPhone(r.driver.user.phone)}</p>
              </>
            ) : (
              <p className="text-sm text-muted">Biriktirilmagan</p>
            )}
          </div>
          {r.vehicle && (
            <div className="flex items-center justify-between">
              <span className="text-sm">
                {r.vehicle.color} {r.vehicle.make} {r.vehicle.model}
              </span>
              <Plate plate={r.vehicle.plateNumber} size="sm" />
            </div>
          )}
          {r.ratings.length > 0 && (
            <div className="text-sm">
              {r.ratings.map((x) => (
                <p key={x.id}>
                  {x.raterRole === "PASSENGER" ? "Yo‘lovchi bahosi" : "Haydovchi bahosi"}: <b>{x.score}/5</b> {x.comment && `— “${x.comment}”`}
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Holatlar tarixi" description="O‘zgarmas jurnal (ride_status_events)" />
        <Table head={["Vaqt", "Dan", "Ga", "Kim", "Sabab"]}>
          {r.statusEvents.map((e) => (
            <tr key={e.id}>
              <Td className="text-muted num">{formatDateTimeUz(e.createdAt)}</Td>
              <Td>{e.fromStatus ?? "—"}</Td>
              <Td className="font-medium">{e.toStatus}</Td>
              <Td>{e.actorType}</Td>
              <Td className="text-muted">{e.reason ?? ""}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Takliflar" description="Dispetcherlik navbati" />
          <Table head={["#", "Haydovchi", "Masofa", "Holat"]} empty="Taklif yuborilmagan">
            {r.offers.map((o) => (
              <tr key={o.id}>
                <Td className="num">{o.sequence}</Td>
                <Td>{o.driver.user.fullName}</Td>
                <Td className="num">
                  {fmtDistance(o.distanceMeters)} · {fmtMinutes(o.etaSeconds)}
                </Td>
                <Td>{OFFER_LABEL[o.status]}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Moliyaviy yozuvlar" description="Ledger (o‘zgartirib bo‘lmaydi)" />
          <Table head={["Hisob", "D/K", "Summa"]} empty="Yozuv yo‘q">
            {r.ledgerEntries.map((l) => (
              <tr key={l.id}>
                <Td className="font-mono text-xs">{l.account}</Td>
                <Td>{l.direction === "DEBIT" ? "Debet" : "Kredit"}</Td>
                <Td>
                  <Money amount={l.amount} size="sm" />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
