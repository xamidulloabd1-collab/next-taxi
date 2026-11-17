"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, Navigation, Phone, ShieldAlert, Star, Wifi, WifiOff } from "lucide-react";
import { MapView } from "@/components/maps/map-view";
import { Alert, Badge, Button, Money, RouteRail, Textarea, cn } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import { useRealtime } from "@/lib/client/realtime";
import { useDriverGps } from "@/lib/client/geolocation";
import { DEFAULT_CENTER, fmtDistance, fmtMinutes, placeLabel, type DriverRide } from "@/features/client/types";

interface Overview {
  status: "PENDING_DOCUMENTS" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";
  availability: "ONLINE" | "OFFLINE";
  fullName: string | null;
  rejectionReason: string | null;
  suspendedReason: string | null;
  city: { name: string; centerLat: number | null; centerLng: number | null; defaultZoom: number } | null;
  vehicle: { plateNumber: string; status: string } | null;
  outstandingCommission: number;
  rating: number | null;
}

interface Offer {
  id: string;
  rideId: string;
  expiresAt: string;
  pickupEtaSeconds: number;
  pickupDistanceMeters: number;
  pickup: { lat: number; lng: number; address: string | null };
  dropoff: { lat: number; lng: number; address: string | null };
  tripDistanceMeters: number;
  tripDurationSeconds: number;
  fare: number;
  note: string | null;
}

const STATUS_COPY: Record<Exclude<Overview["status"], "APPROVED">, { title: string; text: string; tone: "warn" | "danger" | "neutral" }> = {
  PENDING_DOCUMENTS: { title: "Arizani to‘ldiring", text: "Buyurtma olish uchun shaxsiy ma’lumotlar, avtomobil va hujjatlarni yuklang.", tone: "neutral" },
  PENDING_REVIEW: { title: "Ariza tekshirilmoqda", text: "Hujjatlaringiz ko‘rib chiqilmoqda. Tasdiqlangach, ishni boshlashingiz mumkin.", tone: "warn" },
  REJECTED: { title: "Ariza qaytarildi", text: "Izohni o‘qing, kamchiliklarni tuzating va qayta yuboring.", tone: "danger" },
  SUSPENDED: { title: "Hisob vaqtincha to‘xtatilgan", text: "Qo‘llab-quvvatlash xizmatiga murojaat qiling.", tone: "danger" },
};

export default function DriverHome() {
  const qc = useQueryClient();
  const { connected } = useRealtime("driver", (e) => {
    if (e.type === "ride.offer") void qc.invalidateQueries({ queryKey: ["driver-offer"] });
    if (e.type === "ride.offer.closed") void qc.invalidateQueries({ queryKey: ["driver-offer"] });
  });
  const overview = useQuery({ queryKey: ["driver-overview"], queryFn: () => api<{ driver: Overview }>("/driver/profile").then((r) => r.driver) });
  const o = overview.data;
  const approved = o?.status === "APPROVED";
  const online = o?.availability === "ONLINE";

  const active = useQuery({
    queryKey: ["driver-active"],
    queryFn: () => api<{ ride: DriverRide | null }>("/driver/rides/active").then((r) => r.ride),
    enabled: approved,
    refetchInterval: connected ? 20_000 : 6_000,
  });
  const ride = active.data ?? null;
  const offer = useQuery({
    queryKey: ["driver-offer"],
    queryFn: () => api<{ offer: Offer | null; serverTime: string }>("/driver/offers/current"),
    enabled: approved && online && !ride,
    refetchInterval: connected ? 15_000 : 4_000,
  });

  const gps = useDriverGps(approved && (online || Boolean(ride)), (p) => api("/driver/location", { body: p }));
  const me = gps.state.status === "ok" ? { lat: gps.state.lat, lng: gps.state.lng } : null;

  const toggle = useMutation({
    mutationFn: (next: boolean) => api("/driver/availability", { body: { online: next } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["driver-overview"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const [rateRideId, setRateRideId] = useState<string | null>(null);

  if (overview.isLoading) return <main className="min-h-dvh bg-bg" />;
  if (!o) return <main className="p-6"><Alert tone="danger">Profil yuklanmadi.</Alert></main>;

  if (!approved) {
    const c = STATUS_COPY[o.status as Exclude<Overview["status"], "APPROVED">];
    return (
      <main className="mx-auto max-w-md px-4 pt-8 pb-28">
        <p className="text-sm text-muted">Salom{o.fullName ? `, ${o.fullName.split(" ")[0]}` : ""}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{c.title}</h1>
        <Alert tone={c.tone} className="mt-5">
          {c.text}
          {(o.rejectionReason || o.suspendedReason) && <p className="mt-2 font-medium">Izoh: {o.rejectionReason ?? o.suspendedReason}</p>}
        </Alert>
        {(o.status === "PENDING_DOCUMENTS" || o.status === "REJECTED" || o.status === "PENDING_REVIEW") && (
          <Button asChild size="lg" block className="mt-5">
            <Link href="/driver/onboarding">{o.status === "PENDING_REVIEW" ? "Arizani ko‘rish" : "Arizani to‘ldirish"}</Link>
          </Button>
        )}
      </main>
    );
  }

  const center = me ?? (o.city?.centerLat != null && o.city.centerLng != null ? { lat: o.city.centerLat, lng: o.city.centerLng } : DEFAULT_CENTER);
  const target = ride ? (["IN_PROGRESS", "COMPLETED"].includes(ride.status) ? ride.dropoff : ride.pickup) : null;

  return (
    <main className="fixed inset-0 bottom-[calc(56px+env(safe-area-inset-bottom))]">
      <MapView
        dark
        className="absolute inset-0"
        center={center}
        zoom={o.city?.defaultZoom ?? 14}
        driver={me}
        pickup={ride?.pickup ?? offer.data?.offer?.pickup ?? null}
        dropoff={ride?.dropoff ?? offer.data?.offer?.dropoff ?? null}
        route={ride?.routeGeometry ?? null}
        fitKey={`${ride?.id ?? ""}:${ride?.status ?? ""}:${offer.data?.offer?.id ?? ""}:${me ? "me" : ""}`}
      />

      <header className="absolute inset-x-0 top-0 z-10 p-3">
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-surface/95 p-2.5 pl-4 shadow-lg backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{ride ? "Buyurtmada" : online ? "Buyurtma kutilmoqda" : "Oflayn"}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted">
              {connected ? <Wifi className="size-3" /> : <WifiOff className="size-3 text-warn" />}
              <GpsLine state={gps.state} lastSentAt={gps.lastSentAt} active={online || Boolean(ride)} />
            </p>
          </div>
          {!ride && (
            <button
              role="switch"
              aria-checked={online}
              aria-label={online ? "Oflayn bo‘lish" : "Onlayn bo‘lish"}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(!online)}
              className={cn("relative h-11 w-[104px] shrink-0 rounded-xl text-sm font-bold transition-colors", online ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg")}
            >
              {toggle.isPending ? "…" : online ? "Onlayn" : "Ishga chiqish"}
            </button>
          )}
        </div>
        {o.outstandingCommission > 0 && !ride && (
          <p className="mx-auto mt-2 max-w-md rounded-xl bg-surface/95 px-4 py-2 text-xs text-muted shadow">
            Komissiya qarzi: <Money amount={o.outstandingCommission} size="sm" className="text-fg" />
          </p>
        )}
      </header>

      <section className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-md">
        {ride ? (
          <ActiveRidePanel ride={ride} target={target} onSettled={(id) => setRateRideId(id)} />
        ) : online && offer.data?.offer ? (
          <OfferCard offer={offer.data.offer} serverTime={offer.data.serverTime} />
        ) : (
          <IdlePanel online={online} gpsDenied={gps.state.status === "denied" || gps.state.status === "unsupported"} />
        )}
      </section>

      <RatePassenger rideId={rateRideId} onClose={() => setRateRideId(null)} />
    </main>
  );
}

function GpsLine({ state, lastSentAt, active }: { state: ReturnType<typeof useDriverGps>["state"]; lastSentAt: number | null; active: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  if (!active) return <span>GPS o‘chiq</span>;
  if (state.status === "ok") {
    const ago = lastSentAt ? Math.round((Date.now() - lastSentAt) / 1000) : null;
    return (
      <span className="num">
        GPS ±{Math.round(state.accuracy)} m{ago != null ? ` · ${ago} s oldin yuborildi` : ""}
      </span>
    );
  }
  if ("message" in state) return <span className="text-warn">{state.message}</span>;
  return <span>GPS aniqlanmoqda…</span>;
}

function IdlePanel({ online, gpsDenied }: { online: boolean; gpsDenied: boolean }) {
  const earnings = useQuery({ queryKey: ["driver-earnings"], queryFn: () => api<{ today: { rides: number; net: number } }>("/driver/earnings") });
  return (
    <div className="m-3 space-y-3 rounded-3xl border border-border bg-surface p-5 shadow-2xl">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-muted">Bugungi sof daromad</p>
          <Money amount={earnings.data?.today.net ?? 0} size="xl" />
        </div>
        <p className="text-right text-sm text-muted num">{earnings.data?.today.rides ?? 0} ta safar</p>
      </div>
      {gpsDenied ? (
        <Alert tone="danger" title="GPS kerak">Buyurtma olish uchun joylashuvga ruxsat bering.</Alert>
      ) : online ? (
        <p className="text-sm text-muted">Ilovani ochiq qoldiring. Ekran o‘chsa yoki boshqa ilovaga o‘tsangiz, telefon GPS yuborishni to‘xtatishi mumkin — 10 daqiqadan keyin avtomatik oflayn bo‘lasiz.</p>
      ) : (
        <p className="text-sm text-muted">Buyurtma olish uchun “Ishga chiqish”ni bosing.</p>
      )}
    </div>
  );
}

function OfferCard({ offer, serverTime }: { offer: Offer; serverTime: string }) {
  const qc = useQueryClient();
  // Correct for device clock drift using the server's time.
  const [skew] = useState(() => new Date(serverTime).getTime() - Date.now());
  const total = Math.max(1, new Date(offer.expiresAt).getTime() - new Date(serverTime).getTime());
  const [left, setLeft] = useState(total);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, new Date(offer.expiresAt).getTime() - (Date.now() + skew))), 250);
    if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
    return () => clearInterval(t);
  }, [offer.expiresAt, skew]);
  const accept = useMutation({
    mutationFn: () => api(`/driver/offers/${offer.id}/accept`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => {
      toast.error(errorMessage(e));
      void qc.invalidateQueries();
    },
  });
  const reject = useMutation({
    mutationFn: () => api(`/driver/offers/${offer.id}/reject`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries(),
  });
  const seconds = Math.ceil(left / 1000);
  return (
    <div className="nt-rise m-3 overflow-hidden rounded-3xl border border-accent/40 bg-surface shadow-2xl" role="alertdialog" aria-label="Yangi buyurtma">
      <div className="h-1.5 bg-surface-2">
        <div className="h-full origin-left bg-accent" style={{ transform: `scaleX(${left / total})`, transition: "transform 250ms linear" }} />
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between">
          <div>
            <Badge tone="success">Yangi buyurtma · {seconds} s</Badge>
            <p className="mt-2 text-sm text-muted num">
              Mijozgacha {fmtDistance(offer.pickupDistanceMeters)} · ~{fmtMinutes(offer.pickupEtaSeconds)}
            </p>
          </div>
          <Money amount={offer.fare} size="xl" />
        </div>
        <RouteRail pickup={<span className="font-medium">{placeLabel(offer.pickup)}</span>} dropoff={placeLabel(offer.dropoff)} />
        <p className="text-sm text-muted num">
          Safar: {fmtDistance(offer.tripDistanceMeters)} · {fmtMinutes(offer.tripDurationSeconds)} · Naqd
        </p>
        {offer.note && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">“{offer.note}”</p>}
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <Button size="lg" variant="outline" onClick={() => reject.mutate()} loading={reject.isPending} disabled={accept.isPending}>
            Rad etish
          </Button>
          <Button size="lg" variant="accent" onClick={() => accept.mutate()} loading={accept.isPending} disabled={left <= 0 || reject.isPending}>
            Qabul qilish
          </Button>
        </div>
      </div>
    </div>
  );
}

const CANCEL_REASONS = [
  ["VEHICLE_PROBLEM", "Mashinada nosozlik"],
  ["CANNOT_REACH", "Manzilga yetib bo‘lmaydi"],
  ["OTHER", "Boshqa sabab"],
] as const;

function ActiveRidePanel({ ride, target, onSettled }: { ride: DriverRide; target: { lat: number; lng: number } | null; onSettled: (id: string) => void }) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const act = useMutation({
    mutationFn: (body: { action: string; reason?: string }) => api<{ ride: DriverRide | null }>(`/driver/rides/${ride.id}/action`, { body }),
    onSuccess: (_r, body) => {
      if (body.action === "cash-confirm") {
        toast.success(`To‘lov qayd etildi. Daromadingiz: ${(ride.driverEarnings ?? 0).toLocaleString("ru-RU")} so‘m`);
        onSettled(ride.id);
      }
      if (body.action === "cancel") {
        setCancelOpen(false);
        toast.info("Buyurtmadan voz kechdingiz.");
      }
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (ride.status !== "ARRIVED" || !ride.timestamps.arrivedAt) return;
    const t = setInterval(() => setWaited(Math.floor((Date.now() - new Date(ride.timestamps.arrivedAt!).getTime()) / 1000)), 1000);
    return () => clearInterval(t);
  }, [ride.status, ride.timestamps.arrivedAt]);

  const primary: Record<string, { label: string; action: string } | undefined> = {
    ASSIGNED: { label: "Yo‘lga chiqdim", action: "en-route" },
    ARRIVING: { label: "Yetib keldim", action: "arrived" },
    ARRIVED: { label: "Safarni boshlash", action: "start" },
    IN_PROGRESS: { label: "Safarni yakunlash", action: "complete" },
  };
  const step = primary[ride.status];

  if (ride.status === "COMPLETED") {
    return (
      <div className="nt-rise m-3 space-y-4 rounded-3xl border border-border bg-surface p-5 shadow-2xl">
        <p className="text-sm text-muted">Yo‘lovchidan naqd oling</p>
        <Money amount={ride.finalFare} size="xl" className="block text-5xl" />
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
          <span className="text-muted">Komissiya</span>
          <Money amount={ride.commissionAmount} size="sm" className="text-right" />
          <span className="text-muted">Sizga qoladi</span>
          <Money amount={ride.driverEarnings} size="sm" className="text-right text-accent" />
        </div>
        <Button size="lg" variant="accent" block loading={act.isPending} onClick={() => act.mutate({ action: "cash-confirm" })}>
          Naqd pul olindi
        </Button>
      </div>
    );
  }

  const navUrl = target ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving` : null;
  const yandexUrl = target ? `yandexnavi://build_route_on_map?lat_to=${target.lat}&lon_to=${target.lng}` : null;

  return (
    <div className="nt-rise m-3 space-y-4 rounded-3xl border border-border bg-surface p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge tone="success">{ride.statusLabel}</Badge>
          <p className="mt-2 truncate text-lg font-semibold">
            {ride.passenger.name}
            {ride.passenger.rating != null && (
              <span className="ml-2 inline-flex items-center gap-0.5 text-sm text-muted">
                <Star className="size-3.5 fill-warn text-warn" />
                <span className="num">{ride.passenger.rating.toFixed(1)}</span>
              </span>
            )}
          </p>
        </div>
        <Money amount={ride.quotedFare} size="lg" />
      </div>
      <RouteRail compact pickup={<span className={cn("block truncate", !["IN_PROGRESS"].includes(ride.status) && "font-semibold")}>{placeLabel(ride.pickup)}</span>} dropoff={<span className={cn("block truncate", ride.status === "IN_PROGRESS" && "font-semibold")}>{placeLabel(ride.dropoff)}</span>} />
      {ride.note && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">“{ride.note}”</p>}
      <div className="grid grid-cols-3 gap-2">
        {ride.passenger.phone ? (
          <Button asChild variant="outline">
            <a href={`tel:${ride.passenger.phone}`}>
              <Phone className="size-4" /> Qo‘ng‘iroq
            </a>
          </Button>
        ) : (
          <span />
        )}
        {navUrl && (
          <Button asChild variant="outline">
            <a href={navUrl} target="_blank" rel="noreferrer">
              <Navigation className="size-4" /> Google
            </a>
          </Button>
        )}
        {yandexUrl && (
          <Button asChild variant="outline">
            <a href={yandexUrl}>
              <MapPinned className="size-4" /> Yandex
            </a>
          </Button>
        )}
      </div>
      {step && (
        <Button size="lg" variant={ride.status === "IN_PROGRESS" ? "accent" : "primary"} block loading={act.isPending} onClick={() => act.mutate({ action: step.action })}>
          {step.label}
        </Button>
      )}
      <div className="flex justify-between text-sm">
        {ride.status !== "IN_PROGRESS" ? (
          ride.status === "ARRIVED" && waited >= 180 ? (
            <button className="font-medium text-danger" onClick={() => act.mutate({ action: "cancel", reason: "PASSENGER_NO_SHOW" })}>
              Yo‘lovchi chiqmadi
            </button>
          ) : (
            <button className="text-muted hover:text-fg" onClick={() => setCancelOpen(true)}>
              {ride.status === "ARRIVED" ? <span className="num">Kutish: {Math.floor(waited / 60)}:{String(waited % 60).padStart(2, "0")}</span> : "Voz kechish"}
            </button>
          )
        ) : (
          <span />
        )}
        <button className="flex items-center gap-1 font-medium text-danger" onClick={() => setSosOpen(true)}>
          <ShieldAlert className="size-4" /> SOS
        </button>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="Buyurtmadan voz kechasizmi?" description="Buyurtma boshqa haydovchiga beriladi. Tez-tez voz kechish reytingingizga ta’sir qiladi.">
        <div className="grid gap-2">
          {CANCEL_REASONS.map(([v, l]) => (
            <Button key={v} variant="outline" className="justify-start" loading={act.isPending} onClick={() => act.mutate({ action: "cancel", reason: v })}>
              {l}
            </Button>
          ))}
        </div>
      </Dialog>
      <DriverSos open={sosOpen} onOpenChange={setSosOpen} rideId={ride.id} />
    </div>
  );
}

function DriverSos({ open, onOpenChange, rideId }: { open: boolean; onOpenChange: (o: boolean) => void; rideId: string }) {
  const [text, setText] = useState("");
  const mut = useMutation({
    mutationFn: () => api("/driver/incidents", { body: { rideId, description: text.trim() || "SOS tugmasi bosildi", severity: "CRITICAL" } }),
    onSuccess: () => {
      toast.success("Operatorga xabar yuborildi.");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Xavfsizlik" description="Xavf bo‘lsa, avval favqulodda xizmatga qo‘ng‘iroq qiling: 112, 102 yoki 103.">
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {["112", "102", "103"].map((n) => (
            <a key={n} href={`tel:${n}`} className="rounded-xl bg-danger py-3 text-center text-xl font-bold text-white num">
              {n}
            </a>
          ))}
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Nima bo‘ldi?" maxLength={1000} />
        <Button variant="danger" block loading={mut.isPending} onClick={() => mut.mutate()}>
          Operatorga xabar berish
        </Button>
      </div>
    </Dialog>
  );
}

function RatePassenger({ rideId, onClose }: { rideId: string | null; onClose: () => void }) {
  const [score, setScore] = useState(0);
  const mut = useMutation({
    mutationFn: () => api(`/driver/rides/${rideId}/rate`, { body: { score } }),
    onSuccess: () => {
      setScore(0);
      onClose();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      onClose();
    },
  });
  return (
    <Dialog open={Boolean(rideId)} onOpenChange={(o) => !o && onClose()} title="Yo‘lovchini baholang" description="Ixtiyoriy. Baho faqat xizmat sifatini kuzatish uchun ishlatiladi.">
      <div className="flex justify-between" role="radiogroup" aria-label="Baho">
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} role="radio" aria-checked={score === s} aria-label={`${s} yulduz`} onClick={() => setScore(s)} className="p-1.5">
            <Star className={cn("size-9", s <= score ? "fill-warn text-warn" : "text-border")} />
          </button>
        ))}
      </div>
      <Button className="mt-4" block disabled={!score} loading={mut.isPending} onClick={() => mut.mutate()}>
        Baholash
      </Button>
    </Dialog>
  );
}
