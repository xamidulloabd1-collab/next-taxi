import { redirect } from "next/navigation";
import { getAuth, STAFF_ROLES } from "@/lib/auth/session";
import { hasPermission, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { AdminSidebar } from "./sidebar";

const NAV: { href: string; label: string; icon: string; permission: Permission }[] = [
  { href: "/admin", label: "Umumiy holat", icon: "gauge", permission: "dashboard.view" },
  { href: "/admin/live", label: "Jonli safarlar", icon: "radar", permission: "rides.view" },
  { href: "/admin/rides", label: "Safarlar tarixi", icon: "route", permission: "rides.view" },
  { href: "/admin/verification", label: "Tekshiruv navbati", icon: "badge", permission: "drivers.verify" },
  { href: "/admin/drivers", label: "Haydovchilar", icon: "car", permission: "drivers.view" },
  { href: "/admin/vehicles", label: "Avtomobillar", icon: "carfront", permission: "vehicles.view" },
  { href: "/admin/passengers", label: "Yo‘lovchilar", icon: "users", permission: "passengers.view" },
  { href: "/admin/cities", label: "Shaharlar va hududlar", icon: "map", permission: "cities.view" },
  { href: "/admin/tariffs", label: "Tariflar", icon: "tag", permission: "tariffs.view" },
  { href: "/admin/finance", label: "Moliya va hisob-kitob", icon: "wallet", permission: "finance.view" },
  { href: "/admin/support", label: "Murojaatlar", icon: "life", permission: "support.view" },
  { href: "/admin/incidents", label: "Xavfsizlik hodisalari", icon: "shield", permission: "incidents.view" },
  { href: "/admin/settings", label: "Sozlamalar", icon: "settings", permission: "settings.manage" },
  { href: "/admin/audit", label: "Audit jurnali", icon: "scroll", permission: "audit.view" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuth("admin");
  if (!ctx || !ctx.roles.some((r) => STAFF_ROLES.includes(r))) redirect("/admin/login");
  const items = NAV.filter((n) => hasPermission(ctx, n.permission)).map(({ permission: _p, ...rest }) => rest);
  const roleLabel = ctx.roles.filter((r) => STAFF_ROLES.includes(r)).map((r) => ROLE_LABELS[r]).join(", ");
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <AdminSidebar items={items} user={{ name: ctx.fullName ?? ctx.phone, role: roleLabel }} />
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
