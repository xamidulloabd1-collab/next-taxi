"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, Car, CarFront, Gauge, LifeBuoy, LogOut, Map, Menu, Radar, Route, ScrollText, Settings, ShieldAlert, Tag, Users, Wallet, X } from "lucide-react";
import { Logo, cn } from "@/components/ui";
import { api } from "@/lib/client/api";

const ICONS = { gauge: Gauge, radar: Radar, route: Route, badge: BadgeCheck, car: Car, carfront: CarFront, users: Users, map: Map, tag: Tag, wallet: Wallet, life: LifeBuoy, shield: ShieldAlert, settings: Settings, scroll: ScrollText } as const;

export function AdminSidebar({ items, user }: { items: { href: string; label: string; icon: string }[]; user: { name: string; role: string } }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-ink px-4 py-3 text-white md:hidden">
        <Logo inverted className="text-sm" />
        <button onClick={() => setOpen(!open)} aria-label="Menyu" aria-expanded={open}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <aside className={cn("bg-ink text-slate-300 md:sticky md:top-0 md:flex md:h-dvh md:flex-col", open ? "block" : "hidden md:flex")}>
        <div className="hidden px-5 pt-6 pb-5 md:block">
          <Logo inverted className="text-base text-white" />
          <p className="mt-1 text-[11px] tracking-wide text-slate-500 uppercase">Boshqaruv paneli</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Admin menyu">
          {items.map((it) => {
            const Icon = ICONS[it.icon as keyof typeof ICONS] ?? Gauge;
            const active = it.href === "/admin" ? path === "/admin" : path.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", active ? "bg-white/10 font-semibold text-white" : "hover:bg-white/5 hover:text-white")}
              >
                <Icon className={cn("size-4", active && "text-green-400")} /> {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-slate-500">{user.role}</p>
          <button
            className="mt-3 flex items-center gap-2 text-xs text-slate-400 hover:text-white"
            onClick={async () => {
              await api("/auth/logout", { body: { app: "admin" } }).catch(() => undefined);
              router.replace("/admin/login");
            }}
          >
            <LogOut className="size-3.5" /> Chiqish
          </button>
        </div>
      </aside>
    </>
  );
}
