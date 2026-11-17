import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { hasPermission } from "@/lib/permissions";
import { Forbidden, PageHeader, SearchForm, Table, Td } from "@/components/admin/ui";
import { ApiAction } from "@/components/admin/actions";
import { Badge } from "@/components/ui";
import { formatDateTimeUz } from "@/lib/time";
import { formatUzPhone, maskUzPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function PassengersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await staffPage("passengers.view");
  if (!ctx) return <Forbidden />;
  const q = (await searchParams).q?.trim();
  const where: Prisma.UserWhereInput = {
    roles: { some: { role: "PASSENGER" } },
    ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || "-" } }] } : {}),
  };
  const rows = await db().user.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { passengerProfile: true, _count: { select: { ridesAsPassenger: true } } } });
  const canManage = hasPermission(ctx, "passengers.manage");
  // Full phone numbers only appear when an operator searches for a specific person.
  const showFull = Boolean(q);
  return (
    <>
      <PageHeader title="Yo‘lovchilar" description="Telefon raqamlari qidiruvsiz qisman yashiriladi." />
      <SearchForm action="/admin/passengers" q={q} placeholder="Ism yoki telefon raqami" />
      <Table head={["Yo‘lovchi", "Telefon", "Safarlar", "Reyting", "Ro‘yxatdan o‘tgan", "Holat", ""]} empty="Yo‘lovchi topilmadi">
        {rows.map((u) => (
          <tr key={u.id}>
            <Td className="font-medium">{u.fullName ?? "—"}</Td>
            <Td className="num">{showFull ? formatUzPhone(u.phone) : maskUzPhone(u.phone)}</Td>
            <Td className="num">{u._count.ridesAsPassenger}</Td>
            <Td className="num">{u.passengerProfile?.ratingCount ? (u.passengerProfile.ratingSum / u.passengerProfile.ratingCount).toFixed(1) : "—"}</Td>
            <Td className="text-muted">{formatDateTimeUz(u.createdAt).slice(0, 10)}</Td>
            <Td>{u.status === "BLOCKED" ? <Badge tone="danger">Bloklangan</Badge> : <Badge tone="success">Faol</Badge>}</Td>
            <Td>{canManage && <ApiAction label={u.status === "BLOCKED" ? "Blokdan chiqarish" : "Bloklash"} variant="danger-outline" endpoint={`/admin/users/${u.id}/block`} body={{ blocked: u.status !== "BLOCKED" }} reason={{ label: "Sabab", required: true }} />}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
