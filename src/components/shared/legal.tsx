import Link from "next/link";
import { Logo } from "@/components/ui";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/">
        <Logo />
      </Link>
      <h1 className="mt-8 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
        Loyiha matn. Ushbu hujjat O‘zbekiston Respublikasi qonunchiligi (jumladan, “Shaxsga doir ma’lumotlar to‘g‘risida”gi Qonun) bo‘yicha yurist tomonidan ko‘rib chiqilib, tasdiqlanishi kerak.
      </p>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-fg/90 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold">{children}</div>
    </main>
  );
}
