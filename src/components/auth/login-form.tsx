"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { Alert, Button, Field, Input, Logo } from "@/components/ui";

type App = "passenger" | "driver" | "admin";

const COPY: Record<App, { title: string; subtitle: string; next: string }> = {
  passenger: { title: "Kirish", subtitle: "Telefon raqamingizga tasdiqlash kodi yuboramiz.", next: "/passenger" },
  driver: { title: "Haydovchi sifatida kirish", subtitle: "Ro‘yxatdan o‘tish va ishlash uchun telefon raqamingizni kiriting.", next: "/driver" },
  admin: { title: "Boshqaruv paneli", subtitle: "Faqat xodimlar uchun. Kod ruxsat berilgan raqamlarga yuboriladi.", next: "/admin" },
};

function prettyPhone(e164: string) {
  return e164.replace(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/, "+998 $1 $2 $3 $4");
}

export function LoginForm({ app }: { app: App }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; phone: string; channel: "telegram" | "sms" | "console" | null; devCode?: string } | null>(null);
  const [resendIn, setResendIn] = useState(0);
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = COPY[app];

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api<{ challengeId: string; phone: string; channel: "telegram" | "sms" | "console" | null; devCode?: string }>("/auth/otp/request", { body: { phone, app } });
      setChallenge({ id: r.challengeId, phone: r.phone, channel: r.channel, devCode: r.devCode });
      setCode("");
      setResendIn(60);
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      await api("/auth/otp/verify", { body: { challengeId: challenge.id, phone: challenge.phone, code, app } });
      router.replace(copy.next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 pt-10 pb-8">
      <Logo className="text-lg" />
      <div className="mt-12">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-[15px] text-muted">
          {step === "phone"
            ? copy.subtitle
            : challenge?.channel === "telegram"
              ? `Kod ${prettyPhone(challenge.phone)} raqamining Telegram’iga yuborildi. Telegram ilovasini oching.`
              : `Kod ${prettyPhone(challenge?.phone ?? "")} raqamiga SMS orqali yuborildi.`}
        </p>
      </div>

      {step === "phone" ? (
        <form onSubmit={requestCode} className="mt-8 space-y-5">
          <Field label="Telefon raqami" htmlFor="phone">
            <div className="flex">
              <span className="flex h-11 items-center rounded-l-xl border border-r-0 border-border bg-surface-2 px-3 text-[15px] text-muted num">+998</span>
              <Input
                id="phone"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="90 123 45 67"
                className="rounded-l-none num"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
            </div>
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" size="lg" block loading={loading}>
            Kod olish
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-8 space-y-5">
          <Field label="Tasdiqlash kodi" htmlFor="code" hint="Kod 5 daqiqa amal qiladi.">
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="••••••"
              className="h-14 text-center text-2xl tracking-[0.5em] num"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
            />
          </Field>
          {challenge?.channel === "telegram" && (
            <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
              <Send className="size-4 shrink-0 text-[#229ED9]" /> Kod Telegram’dagi tasdiqlash kodlari chatiga keladi.
            </p>
          )}
          {challenge?.devCode && (
            <Alert tone="warn" title="Test rejimi">
              {challenge.channel === "console" ? "SMS yuborilmadi." : "Kod ekranda ham ko‘rsatilmoqda (OTP_DEV_ECHO)."} Kod: <span className="font-mono font-bold">{challenge.devCode}</span>
            </Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" size="lg" block loading={loading} disabled={code.length !== 6}>
            Tasdiqlash
          </Button>
          <Button type="button" variant="outline" block disabled={resendIn > 0 || loading} onClick={() => void requestCode()}>
            {resendIn > 0 ? <span className="num">Kodni qayta yuborish ({resendIn} s)</span> : "Kodni qayta yuborish"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            block
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
          >
            <ArrowLeft className="size-4" /> Raqamni o‘zgartirish
          </Button>
        </form>
      )}
      <p className="mt-auto pt-10 text-center text-xs text-muted">
        Kirish orqali siz <a className="underline" href="/legal/terms">foydalanish shartlari</a> va <a className="underline" href="/legal/privacy">maxfiylik siyosati</a>ga rozilik bildirasiz.
      </p>
    </main>
  );
}
