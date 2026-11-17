import Link from "next/link";
import { db } from "@/lib/db/prisma";
import { staffPage } from "@/features/admin/page-guard";
import { Forbidden, PageHeader, SearchForm, Table, Td } from "@/components/admin/ui";
import { formatDateTimeUz } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await staffPage("audit.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const q = sp.q?.trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const where = q ? { OR: [{ action: { contains: q } }, { entityType: { contains: q } }, { entityId: q }] } : {};
  const rows = await db().auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, skip: (page - 1) * 100, include: { actor: { select: { fullName: true, phone: true } } } });
  return (
    <>
      <PageHeader title="Audit jurnali" description="Xodimlarning barcha muhim amallari. Yozuvlarni o‘zgartirish yoki o‘chirish ma’lumotlar bazasi darajasida taqiqlangan." />
      <SearchForm action="/admin/audit" q={q} placeholder="Amal (driver.approve), obyekt turi yoki ID" />
      <Table head={["Vaqt", "Xodim", "Amal", "Obyekt", "IP", "O‘zgarish"]} empty="Yozuv yo‘q">
        {rows.map((a) => (
          <tr key={a.id}>
            <Td className="whitespace-nowrap text-muted num">{formatDateTimeUz(a.createdAt)}</Td>
            <Td>{a.actor?.fullName ?? a.actor?.phone ?? "Tizim"}</Td>
            <Td className="font-mono text-xs">{a.action}</Td>
            <Td className="font-mono text-xs">
              {a.entityType}
              {a.entityId && <span className="block text-muted">{a.entityId.slice(0, 13)}</span>}
            </Td>
            <Td className="text-xs text-muted">{a.ip ?? "—"}</Td>
            <Td>
              {(a.before != null || a.after != null) && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-accent">Ko‘rish</summary>
                  <pre className="mt-1 max-h-48 max-w-md overflow-auto rounded-lg bg-surface-2 p-2">{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                </details>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      {rows.length === 100 && (
        <Link className="mt-4 inline-block rounded-lg border border-border px-3 py-1.5 text-sm" href={`/admin/audit?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`}>
          Keyingi →
        </Link>
      )}
    </>
  );
}
