import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { canAccessCity, hasPermission } from "@/lib/permissions";
import { Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { Badge, Card, CardHeader, Money } from "@/components/ui";
import { formatDateTimeUz } from "@/lib/time";
import { TariffForm } from "./tariff-form";

export const dynamic = "force-dynamic";

export default async function TariffsPage() {
  const ctx = await staffPage("tariffs.view");
  if (!ctx) return <Forbidden />;
  const cities = (await db().city.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { tariffs: { orderBy: [{ vehicleClass: "asc" }, { version: "desc" }] } } })).filter((c) => canAccessCity(ctx, c.id));
  const canEdit = hasPermission(ctx, "tariffs.manage");
  return (
    <>
      <PageHeader title="Tariflar" description="Tarifni o‘zgartirish yangi versiya yaratadi. Avval berilgan narxlar o‘z versiyasi bo‘yicha qoladi." />
      {canEdit && <TariffForm cities={cities.map((c) => ({ id: c.id, name: c.name, active: c.tariffs.filter((t) => t.isActive).map((t) => ({ vehicleClass: t.vehicleClass, name: t.name, baseFare: t.baseFare, perKm: t.perKm, perMinute: t.perMinute, minimumFare: t.minimumFare, roundingStep: t.roundingStep, commissionBps: t.commissionBps, quoteTtlSeconds: t.quoteTtlSeconds })) }))} />}
      <div className="mt-6 space-y-4">
        {cities
          .filter((c) => c.tariffs.length > 0)
          .map((c) => (
            <Card key={c.id}>
              <CardHeader title={c.name} />
              <Table head={["Sinf", "Versiya", "Boshlang‘ich", "1 km", "1 daqiqa", "Minimal", "Yaxlitlash", "Komissiya", "Holat"]}>
                {c.tariffs.map((t) => (
                  <tr key={t.id} className={t.isActive ? "" : "text-muted"}>
                    <Td className="font-medium">{t.name}</Td>
                    <Td className="num">v{t.version}</Td>
                    <Td><Money amount={t.baseFare} size="sm" /></Td>
                    <Td><Money amount={t.perKm} size="sm" /></Td>
                    <Td><Money amount={t.perMinute} size="sm" /></Td>
                    <Td><Money amount={t.minimumFare} size="sm" /></Td>
                    <Td className="num">{t.roundingStep}</Td>
                    <Td className="num">{(t.commissionBps / 100).toFixed(2)}%</Td>
                    <Td>{t.isActive ? <Badge tone="success">Faol</Badge> : <span className="text-xs">{t.supersededAt ? `${formatDateTimeUz(t.supersededAt).slice(0, 10)} gacha` : "Faol emas"}</span>}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          ))}
      </div>
    </>
  );
}
