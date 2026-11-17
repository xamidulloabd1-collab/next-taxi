import Link from "next/link";
import { ArrowRight, Banknote, MapPin, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db/prisma";
import { Logo, Plate, RouteRail, Money } from "@/components/ui";

export const dynamic = "force-dynamic";

async function pilotStatus() {
  try {
    const city = await db().city.findUnique({ where: { slug: "guzor" }, select: { status: true, operatingHoursStart: true, operatingHoursEnd: true } });
    return city;
  } catch {
    return null;
  }
}

export default async function Home() {
  const city = await pilotStatus();
  const active = city?.status === "ACTIVE";
  const allDay = city && city.operatingHoursStart === city.operatingHoursEnd;
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5">
      <header className="flex items-center justify-between py-5">
        <Logo className="text-lg" />
        <Link href="/driver/login" className="text-sm font-medium text-muted hover:text-fg">
          Haydovchilar uchun
        </Link>
      </header>

      <section className="grid flex-1 items-center gap-10 py-8 md:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted">
            <span className={active ? "size-2 rounded-full bg-accent" : "size-2 rounded-full bg-warn"} />
            G‘uzor · {active ? (allDay ? "kun bo‘yi ishlaydi" : `${city?.operatingHoursStart}–${city?.operatingHoursEnd}`) : "tez orada ishga tushadi"}
          </p>
          <h1 className="mt-5 text-[40px] leading-[1.05] font-black tracking-tight md:text-6xl">
            Narxini bilib,
            <br />
            keyin chaqiring.
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted">
            Manzilni xaritada belgilang — narx buyurtmadan oldin ko‘rinadi. Haydovchi, uning mashinasi va davlat raqami ekranda chiqadi, yo‘lda kelayotganini kuzatasiz.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/passenger" className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-fg hover:opacity-90">
              Taksi chaqirish <ArrowRight className="size-4" />
            </Link>
            <Link href="/driver" className="inline-flex h-14 items-center justify-center rounded-xl border border-border bg-surface px-6 font-semibold hover:bg-surface-2">
              Haydovchi bo‘lish
            </Link>
          </div>
        </div>

        {/* A ride, as the passenger sees it: route, fare, and the plate to look for. */}
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-[0_24px_60px_-30px_rgba(11,18,32,0.35)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Haydovchi yo‘lda</p>
            <p className="text-sm text-muted num">~4 daq</p>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
            <div>
              <p className="text-xs text-muted">Oq Chevrolet Cobalt</p>
              <div className="mt-2">
                <Plate plate="70A123BC" size="lg" />
              </div>
            </div>
          </div>
          <div className="mt-5">
            <RouteRail pickup={<span className="text-muted">Olib ketish nuqtasi</span>} dropoff={<span className="text-muted">Borish manzili</span>} />
          </div>
          <div className="mt-5 flex items-end justify-between border-t border-border pt-4">
            <span className="text-sm text-muted">Naqd to‘lov</span>
            <Money amount={13500} size="lg" />
          </div>
          <p className="mt-3 text-xs text-muted">Namuna ko‘rinish. Narx tarif va masofaga qarab hisoblanadi.</p>
        </div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        {[
          { icon: Banknote, title: "Narx oldindan", text: "Buyurtma berishdan oldin aniq summa ko‘rsatiladi va safar davomida o‘zgarmaydi." },
          { icon: MapPin, title: "Xaritada kuzatish", text: "Haydovchi qayerdaligini va qachon yetib kelishini ko‘rib turasiz." },
          { icon: ShieldCheck, title: "Tekshirilgan haydovchilar", text: "Guvohnoma, texpasport va mashina tekshiruvdan o‘tgandan keyingina buyurtma oladi." },
        ].map((f) => (
          <div key={f.title} className="bg-surface p-5">
            <f.icon className="size-5 text-accent" />
            <p className="mt-3 font-semibold">{f.title}</p>
            <p className="mt-1 text-sm text-muted">{f.text}</p>
          </div>
        ))}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 py-8 text-xs text-muted">
        <span>© {new Date().getFullYear()} NEXT TAXI · G‘uzor, Qashqadaryo</span>
        <span className="flex gap-4">
          <Link href="/legal/terms">Shartlar</Link>
          <Link href="/legal/privacy">Maxfiylik</Link>
          <Link href="/admin/login">Xodimlar</Link>
        </span>
      </footer>
    </main>
  );
}
