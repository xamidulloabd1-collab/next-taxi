import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { Forbidden, PageHeader, Table, Td } from "@/components/admin/ui";
import { ApiAction } from "@/components/admin/actions";
import { Card, CardHeader } from "@/components/ui";
import { listSettings } from "@/features/settings/service";
import { ROLE_LABELS } from "@/lib/permissions";
import { STAFF_ROLES } from "@/lib/auth/session";
import { formatUzPhone } from "@/lib/phone";
import { SettingRow, StaffForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await staffPage("settings.manage");
  if (!ctx) return <Forbidden />;
  const [settings, staff, cities] = await Promise.all([
    listSettings(),
    db().userRole.findMany({ where: { role: { in: STAFF_ROLES } }, include: { user: true, city: true }, orderBy: { createdAt: "asc" } }),
    db().city.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Sozlamalar" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Tizim sozlamalari" description="O‘zgarishlar audit jurnaliga yoziladi." />
          <ul className="divide-y divide-border border-t border-border">
            {settings.map((s) => (
              <SettingRow key={s.key} k={s.key} description={s.description} value={s.value} isDefault={s.isDefault} />
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Xodimlar va rollar" description="Har bir xodim faqat o‘z roliga mos bo‘limlarni ko‘radi va o‘zgartira oladi." />
          <div className="px-5 pb-4">
            <StaffForm cities={cities} />
          </div>
          <Table head={["Xodim", "Rol", "Shahar", ""]}>
            {staff.map((r) => (
              <tr key={r.id}>
                <Td>
                  {r.user.fullName ?? "—"}
                  <span className="block text-xs text-muted num">{formatUzPhone(r.user.phone)}</span>
                </Td>
                <Td>{ROLE_LABELS[r.role]}</Td>
                <Td>{r.city?.name ?? "Barchasi"}</Td>
                <Td>{r.userId !== ctx.userId && <ApiAction label="Olib tashlash" variant="danger-outline" method="DELETE" endpoint="/admin/staff" body={{ userId: r.userId, role: r.role }} confirm="Xodimning bu roli va barcha sessiyalari bekor qilinadi." />}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
