import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { cn } from "@/components/ui";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-border bg-surface px-6 py-16 text-center">
      <ShieldOff className="size-8 text-muted" />
      <p className="mt-3 font-semibold">Bu bo‘lim uchun ruxsatingiz yo‘q</p>
      <p className="mt-1 text-sm text-muted">Kerak bo‘lsa, bosh administratordan ruxsat so‘rang.</p>
    </div>
  );
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border bg-surface-2/60 text-xs text-muted uppercase">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-semibold tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-4 py-10 text-center text-muted">
                {empty ?? "Ma’lumot yo‘q"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-top", className)}>{children}</td>;
}

export function Kpi({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold num">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="rounded-2xl border border-border bg-surface p-4 hover:border-fg/20">
      {body}
    </Link>
  ) : (
    <div className="rounded-2xl border border-border bg-surface p-4">{body}</div>
  );
}

export function FilterTabs({ base, current, options, param = "status" }: { base: string; current: string; options: [string, string][]; param?: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <Link
          key={v}
          href={v ? `${base}?${param}=${v}` : base}
          className={cn("rounded-full border px-3 py-1 text-sm", current === v ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-muted hover:text-fg")}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}

export function SearchForm({ action, q, placeholder }: { action: string; q?: string; placeholder: string }) {
  return (
    <form action={action} className="mb-4 flex max-w-md gap-2">
      <input name="q" defaultValue={q} placeholder={placeholder} className="h-10 flex-1 rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-accent" />
      <button className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg">Qidirish</button>
    </form>
  );
}
