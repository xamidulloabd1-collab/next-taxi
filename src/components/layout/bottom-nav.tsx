"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/ui";

export function BottomNav({ items }: { items: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur" aria-label="Asosiy menyu">
      <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const active = it.exact ? path === it.href : path === it.href || path.startsWith(`${it.href}/`);
          return (
            <li key={it.href}>
              <Link href={it.href} className={cn("flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] font-medium", active ? "text-fg" : "text-muted")} aria-current={active ? "page" : undefined}>
                <it.icon className={cn("size-5", active && "text-accent")} strokeWidth={active ? 2.4 : 2} />
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
