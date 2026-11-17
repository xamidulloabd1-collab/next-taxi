"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Phone, Search, ShieldAlert, Star, X, Wifi, WifiOff } from "lucide-react";
import { MapView } from "@/components/maps/map-view";
import { Alert, Button, Input, Logo, Money, Plate, RouteRail, Textarea, cn } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import { useLiveLocation, useRealtime } from "@/lib/client/realtime";
import { useCurrentPosition } from "@/lib/client/geolocation";
import { DEFAULT_CENTER, fmtDistance, fmtMinutes, placeLabel, type CitiesResponse, type PassengerRide, type Place, type Quote } from "@/features/client/types";

const TRACK_KEY = "nt-tracked-ride";
const store = {
  get: () => {
    try {
      return sessionStorage.getItem(TRACK_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) sessionStorage.setItem(TRACK_KEY, v);
      else sessionStorage.removeItem(TRACK_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export default function PassengerHome() {
  const qc = useQueryClient();
  const { connected } = useRealtime("passenger");
  const cities = useQuery({ queryKey: ["cities"], queryFn: () => api<CitiesResponse>("/cities"), staleTime: 300_000 });
  const city = cities.data?.cities[0] ?? null;
  const center = city?.center ?? DEFAULT_CENTER;

  const active = useQuery({
    queryKey: ["passenger-active"],
    queryFn: () => api<{ ride: PassengerRide | null }>("/passenger/rides/active"),
    refetchInterval: (q) => (q.state.data?.ride ? (connected ? 15_000 : 5_000) : false),
  });
  const ride = active.data?.ride ?? null;

  // Remember the ride we are following, to show its outcome after it leaves "active".
  const [trackedId, setTrackedId] = useState<string | null>(null);
  useEffect(() => setTrackedId(store.get()), []);
  useEffect(() => {
    if (ride && ride.id !== trackedId) {
      setTrackedId(ride.id);
      store.set(ride.id);
    }
  }, [ride, trackedId]);
  const finished = useQuery({
    queryKey: ["passenger-ride", trackedId],
    queryFn: () => api<{ ride: PassengerRide }>(`/passenger/rides/${trackedId}`),
    enabled: Boolean(trackedId) && !ride && active.isSuccess,
  });
  const outcome = !ride && finished.data?.ride ? finished.data.ride : null;
  const closeOutcome = () => {
    store.set(null);
    setTrackedId(null);
  };

  // ── Booking draft ──
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [selecting, setSelecting] = useState<"pickup" | "dropoff">("pickup");
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const idemKey = useRef(newIdempotencyKey());
  const geo = useCurrentPosition();
  const geocoding = cities.data?.features.geocoding ?? false;

  useEffect(() => {
    geo.locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (geo.state.status === "ok" && !pickup) {
      void setPoint("pickup", { lat: geo.state.lat, lng: geo.state.lng });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.state.status]);

  async function setPoint(which: "pickup" | "dropoff", p: { lat: number; lng: number }, address: string | null = null) {
    const place: Place = { lat: p.lat, lng: p.lng, address };
    if (which === "pickup") setPickup(place);
    else setDropoff(place);
    setQuotes(null);
    if (which === "pickup" && !dropoff) setSelecting("dropoff");
    if (!address && geocoding) {
      try {
        const r = await api<{ label: string; resolved: boolean }>(`/geo/reverse?lat=${p.lat}&lng=${p.lng}`);
        if (r.resolved) (which === "pickup" ? setPickup : setDropoff)((cur) => (cur && cur.lat === p.lat && cur.lng === p.lng ? { ...cur, address: r.label } : cur));
      } catch {
        /* label stays as coordinates */
      }
    }
  }

  const quoteMut = useMutation({
    mutationFn: () => api<{ quotes: Quote[] }>("/passenger/quotes", { body: { pickup, dropoff } }),
    onSuccess: (r) => {
      setQuotes(r.quotes);
      setSelectedQuote(r.quotes[0]?.id ?? null);
      idemKey.current = newIdempotencyKey();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const bookMut = useMutation({
    mutationFn: () => api<{ ride: PassengerRide }>("/passenger/rides", { body: { quoteId: selectedQuote, note: note.trim() || null }, idempotencyKey: idemKey.current }),
    onSuccess: (r) => {
      qc.setQueryData(["passenger-active"], { ride: r.ride });
      setQuotes(null);
      setNote("");
      store.set(r.ride.id);
      setTrackedId(r.ride.id);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      idemKey.current = newIdempotencyKey();
      void qc.invalidateQueries({ queryKey: ["passenger-active"] });
    },
  });

  const live = useLiveLocation((s) => s.loc);
  const driverPos = ride?.driver?.location ? (live && live.rideId === ride.id && live.recordedAt > ride.driver.location.recordedAt ? live : ride.driver.location) : null;
  const chosen = quotes?.find((q) => q.id === selectedQuote) ?? null;

  const zones = useMemo(() => city?.zones.map((z) => z.boundary) ?? [], [city]);
  const mapPickup = ride ? ride.pickup : pickup;
  const mapDropoff = ride ? ride.dropoff : dropoff;
  const route = ride?.routeGeometry ?? chosen?.routeGeometry ?? null;
  const fitKey = `${ride?.id ?? ""}:${ride?.status ?? ""}:${chosen?.id ?? ""}:${pickup?.lat ?? ""}:${dropoff?.lat ?? ""}`;

  return (
    <main className="fixed inset-0 bottom-[calc(56px+env(safe-area-inset-bottom))] flex flex-col">
      <MapView
        className="absolute inset-0"
        center={center}
        zoom={city?.zoom ?? 13.5}
        zones={zones}
        pickup={mapPickup}
        dropoff={mapDropoff}
        driver={driverPos}
        route={route}
        pulsePickup={ride?.status === "SEARCHING"}
        fitKey={fitKey}
        onMapClick={ride ? undefined : (p) => void setPoint(selecting, p)}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
        <span className="pointer-events-auto rounded-full bg-surface/95 px-3 py-2 shadow-sm">
          <Logo className="text-sm" />
        </span>
        <span className={cn("pointer-events-auto flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs shadow-sm", connected ? "bg-surface/95 text-muted" : "bg-warn-soft text-warn")}>
          {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {connected ? "Onlayn" : "Qayta ulanmoqda"}
        </span>
      </header>

      <section className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-md">
        <div className="nt-rise rounded-t-3xl border border-b-0 border-border bg-surface px-5 pt-3 pb-5 shadow-[0_-12px_40px_-20px_rgba(11,18,32,0.35)]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
          {active.isLoading ? (
            <p className="py-6 text-center text-sm text-muted">Yuklanmoqda…</p>
          ) : ride ? (
            <ActiveRide ride={ride} supportPhone={cities.data?.supportPhone ?? ""} cancelReasons={cities.data?.cancelReasons ?? []} />
          ) : outcome && ["SETTLED", "COMPLETED", "CANCELLED", "NO_DRIVER"].includes(outcome.status) ? (
            <Outcome
              ride={outcome}
              onClose={closeOutcome}
              onRetry={() => {
                setPickup(outcome.pickup);
                setDropoff(outcome.dropoff);
                closeOutcome();
              }}
            />
          ) : quotes ? (
            <QuoteStep
              quotes={quotes}
              selected={selectedQuote}
              onSelect={(id) => {
                setSelectedQuote(id);
                idemKey.current = newIdempotencyKey();
              }}
              note={note}
              onNote={setNote}
              pickup={pickup}
              dropoff={dropoff}
              onBack={() => setQuotes(null)}
              onBook={() => bookMut.mutate()}
              onRequote={() => quoteMut.mutate()}
              booking={bookMut.isPending}
            />
          ) : (
            <PlanStep
              pickup={pickup}
              dropoff={dropoff}
              selecting={selecting}
              onSelecting={setSelecting}
              onLocate={() => geo.locate()}
              locating={geo.state.status === "locating"}
              geoError={"message" in geo.state ? geo.state.message : null}
              geocoding={geocoding}
              near={center}
              onPick={(which, p) => void setPoint(which, p, p.address)}
              onClear={(which) => (which === "pickup" ? setPickup(null) : setDropoff(null))}
              onQuote={() => quoteMut.mutate()}
              quoting={quoteMut.isPending}
              noService={cities.isSuccess && !city}
            />
          )}
        </div>
      </section>
    </main>
  );
}

// ───────────────────────── Plan ─────────────────────────

function PlanStep(props: {
  pickup: Place | null;
  dropoff: Place | null;
  selecting: "pickup" | "dropoff";
  onSelecting: (w: "pickup" | "dropoff") => void;
  onLocate: () => void;
  locating: boolean;
  geoError: string | null;
  geocoding: boolean;
  near: { lat: number; lng: number };
  onPick: (w: "pickup" | "dropoff", p: Place) => void;
  onClear: (w: "pickup" | "dropoff") => void;
  onQuote: () => void;
  quoting: boolean;
  noService: boolean;
}) {
  const { pickup, dropoff, selecting } = props;
  if (props.noService) {
    return <Alert tone="warn" title="Xizmat hali ishga tushmagan">Hozircha faol shahar yo‘q. Ishga tushganda shu yerda buyurtma berishingiz mumkin bo‘ladi.</Alert>;
  }
  const row = (which: "pickup" | "dropoff", value: Place | null, placeholder: string) => (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        selecting === which ? "border-accent bg-accent-soft/40" : "border-border bg-surface-2/60",
      )}
    >
      <span className={which === "pickup" ? "size-2.5 shrink-0 rounded-full bg-accent" : "size-2.5 shrink-0 rounded-[3px] bg-primary"} aria-hidden />
      <button type="button" onClick={() => props.onSelecting(which)} className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] font-medium text-muted">{which === "pickup" ? "Qayerdan" : "Qayerga"}</span>
        <span className={cn("block truncate text-[15px]", value ? "text-fg" : "text-muted")}>{value ? placeLabel(value) : placeholder}</span>
      </button>
      {value && (
        <button type="button" onClick={() => props.onClear(which)} className="rounded-lg p-1 text-muted hover:text-fg" aria-label="Tozalash">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">Qayerga boramiz?</h1>
        <button type="button" onClick={props.onLocate} className="flex items-center gap-1.5 text-sm font-medium text-accent" disabled={props.locating}>
          <Crosshair className="size-4" /> {props.locating ? "Aniqlanmoqda…" : "Mening joyim"}
        </button>
      </div>
      {row("pickup", pickup, "Olib ketish nuqtasi")}
      {row("dropoff", dropoff, "Borish manzili")}
      {props.geocoding && <AddressSearch near={props.near} onPick={(p) => props.onPick(selecting, p)} placeholder={selecting === "pickup" ? "Olib ketish manzilini qidiring" : "Borish manzilini qidiring"} />}
      <p className="text-xs text-muted">{selecting === "pickup" ? "Xaritada olib ketish nuqtasini bosing." : "Xaritada borish manzilini bosing."}</p>
      {props.geoError && !pickup && <p className="text-xs text-warn">{props.geoError}</p>}
      <Button size="lg" block onClick={props.onQuote} disabled={!pickup || !dropoff} loading={props.quoting}>
        Narxni ko‘rish
      </Button>
    </div>
  );
}

function AddressSearch({ near, onPick, placeholder }: { near: { lat: number; lng: number }; onPick: (p: Place) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({
    queryKey: ["geo", debounced],
    queryFn: () => api<{ results: { label: string; lat: number; lng: number }[] }>(`/geo/search?q=${encodeURIComponent(debounced)}&lat=${near.lat}&lng=${near.lng}`),
    enabled: debounced.length >= 3,
    staleTime: 60_000,
  });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
      {debounced.length >= 3 && (results.data?.results.length ?? 0) > 0 && (
        <ul className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
          {results.data!.results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                className="w-full px-3.5 py-2.5 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  onPick({ lat: r.lat, lng: r.lng, address: r.label });
                  setQ("");
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── Quote ─────────────────────────

function QuoteStep(props: {
  quotes: Quote[];
  selected: string | null;
  onSelect: (id: string) => void;
  note: string;
  onNote: (v: string) => void;
  pickup: Place | null;
  dropoff: Place | null;
  onBack: () => void;
  onBook: () => void;
  onRequote: () => void;
  booking: boolean;
}) {
  const chosen = props.quotes.find((q) => q.id === props.selected) ?? props.quotes[0]!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const expired = new Date(chosen.expiresAt).getTime() <= now;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Tarifni tanlang</h1>
        <button onClick={props.onBack} className="text-sm font-medium text-muted hover:text-fg">
          Manzilni o‘zgartirish
        </button>
      </div>
      <RouteRail compact pickup={<span className="block truncate">{placeLabel(props.pickup)}</span>} dropoff={<span className="block truncate">{placeLabel(props.dropoff)}</span>} />
      <div className="grid gap-2" role="radiogroup" aria-label="Tarif">
        {props.quotes.map((q) => (
          <button
            key={q.id}
            role="radio"
            aria-checked={q.id === chosen.id}
            onClick={() => props.onSelect(q.id)}
            className={cn("flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors", q.id === chosen.id ? "border-primary bg-surface ring-1 ring-primary" : "border-border bg-surface-2/60")}
          >
            <span>
              <span className="block font-semibold">{q.vehicleClassLabel}</span>
              <span className="text-xs text-muted num">
                {fmtDistance(q.distanceMeters)} · {fmtMinutes(q.durationSeconds)}
                {q.routeEstimated && " · taxminiy"}
              </span>
            </span>
            <Money amount={q.totalFare} size="lg" />
          </button>
        ))}
      </div>
      <Textarea value={props.note} onChange={(e) => props.onNote(e.target.value)} placeholder="Haydovchiga izoh: podyezd, mo‘ljal (ixtiyoriy)" maxLength={300} className="min-h-16" />
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">To‘lov</span>
        <span className="font-medium">Naqd pul</span>
      </div>
      {expired ? (
        <Button size="lg" block variant="outline" onClick={props.onRequote}>
          Narx muddati tugadi — yangilash
        </Button>
      ) : (
        <Button size="lg" variant="accent" block onClick={props.onBook} loading={props.booking}>
          Buyurtma berish · <Money amount={chosen.totalFare} className="text-accent-fg [&>span]:text-accent-fg/80" />
        </Button>
      )}
      {chosen.routeEstimated && <p className="text-xs text-muted">Masofa to‘g‘ri chiziq bo‘yicha taxminiy hisoblangan. Narx buyurtma vaqtida qat’iy belgilanadi.</p>}
    </div>
  );
}

// ───────────────────────── Active ride ─────────────────────────

function ActiveRide({ ride, supportPhone, cancelReasons }: { ride: PassengerRide; supportPhone: string; cancelReasons: string[] }) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const cancelMut = useMutation({
    mutationFn: (reason: string) => api(`/passenger/rides/${ride.id}/cancel`, { body: { reason } }),
    onSuccess: () => {
      setCancelOpen(false);
      toast.info("Buyurtma bekor qilindi.");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canCancel = ["REQUESTED", "SEARCHING", "ASSIGNED", "ARRIVING", "ARRIVED"].includes(ride.status);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (ride.status !== "SEARCHING") return;
    const start = new Date(ride.timestamps.requestedAt ?? Date.now()).getTime();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [ride.status, ride.timestamps.requestedAt]);

  const headline: Record<string, string> = {
    REQUESTED: "Buyurtma yuborildi",
    SEARCHING: "Yaqin haydovchi qidirilmoqda",
    ASSIGNED: "Haydovchi topildi",
    ARRIVING: "Haydovchi yo‘lda",
    ARRIVED: "Haydovchi sizni kutmoqda",
    IN_PROGRESS: "Safardasiz",
    COMPLETED: "Yetib keldingiz",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{headline[ride.status] ?? ride.statusLabel}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {ride.status === "SEARCHING" && <span className="num">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · </span>}
            {ride.status === "ARRIVED" && "Mashina raqamiga qarab chiqing · "}
            {ride.status === "COMPLETED" ? "Haydovchiga naqd to‘lang" : `Buyurtma ${ride.code}`}
          </p>
        </div>
        <Money amount={ride.finalFare ?? ride.quotedFare} size="lg" />
      </div>

      {ride.driver && ride.vehicle && (
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{ride.driver.name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                {ride.driver.rating != null && (
                  <>
                    <Star className="size-3.5 fill-warn text-warn" /> <span className="num">{ride.driver.rating.toFixed(1)}</span> ·{" "}
                  </>
                )}
                {ride.vehicle.color} {ride.vehicle.make} {ride.vehicle.model}
              </p>
            </div>
            {ride.driver.phone && (
              <a href={`tel:${ride.driver.phone}`} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg" aria-label="Haydovchiga qo‘ng‘iroq qilish">
                <Phone className="size-5" />
              </a>
            )}
          </div>
          <div className="mt-3">
            <Plate plate={ride.vehicle.plateNumber} size={ride.status === "ARRIVED" ? "lg" : "md"} />
          </div>
        </div>
      )}

      {ride.status === "SEARCHING" && <p className="text-sm text-muted">Taklif yaqin haydovchilarga navbat bilan yuboriladi. Odatda bir necha daqiqa davom etadi.</p>}

      <RouteRail compact pickup={<span className="block truncate">{placeLabel(ride.pickup)}</span>} dropoff={<span className="block truncate">{placeLabel(ride.dropoff)}</span>} />

      <div className="flex gap-2">
        {canCancel && (
          <Button variant="outline" block onClick={() => setCancelOpen(true)}>
            Bekor qilish
          </Button>
        )}
        {["ASSIGNED", "ARRIVING", "ARRIVED", "IN_PROGRESS"].includes(ride.status) && (
          <Button variant="danger-outline" block={!canCancel} onClick={() => setSosOpen(true)} aria-label="Xavfsizlik: yordam chaqirish">
            <ShieldAlert className="size-4" /> SOS
          </Button>
        )}
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="Buyurtmani bekor qilasizmi?" description="Sababni tanlang — bu xizmatni yaxshilashga yordam beradi.">
        <div className="grid gap-2">
          {(cancelReasons.length ? cancelReasons : ["Rejam o‘zgardi", "Boshqa sabab"]).map((r) => (
            <Button key={r} variant="outline" block className="justify-start" loading={cancelMut.isPending && cancelMut.variables === r} onClick={() => cancelMut.mutate(r)}>
              {r}
            </Button>
          ))}
        </div>
      </Dialog>
      <SosDialog open={sosOpen} onOpenChange={setSosOpen} rideId={ride.id} supportPhone={supportPhone} />
    </div>
  );
}

function SosDialog({ open, onOpenChange, rideId, supportPhone }: { open: boolean; onOpenChange: (o: boolean) => void; rideId: string; supportPhone: string }) {
  const [text, setText] = useState("");
  const mut = useMutation({
    mutationFn: async () => {
      let lat: number | null = null;
      let lng: number | null = null;
      try {
        const p = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
        lat = p.coords.latitude;
        lng = p.coords.longitude;
      } catch {
        /* location optional */
      }
      return api("/passenger/incidents", { body: { rideId, description: text.trim() || "SOS tugmasi bosildi", severity: "CRITICAL", lat, lng } });
    },
    onSuccess: () => {
      toast.success("Xabaringiz operatorga yuborildi.");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Xavfsizlik" description="Hayotingizga xavf bo‘lsa, darhol favqulodda xizmatga qo‘ng‘iroq qiling.">
      <div className="grid grid-cols-3 gap-2">
        {[
          { n: "112", l: "Yagona xizmat" },
          { n: "102", l: "Militsiya" },
          { n: "103", l: "Tez yordam" },
        ].map((x) => (
          <a key={x.n} href={`tel:${x.n}`} className="rounded-xl bg-danger px-2 py-3 text-center text-white">
            <span className="block text-xl font-bold num">{x.n}</span>
            <span className="text-xs">{x.l}</span>
          </a>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Nima bo‘ldi? (ixtiyoriy)" maxLength={1000} />
        <Button variant="danger" block loading={mut.isPending} onClick={() => mut.mutate()}>
          NEXT TAXI operatoriga xabar berish
        </Button>
        {supportPhone && (
          <Button asChild variant="outline" block>
            <a href={`tel:${supportPhone}`}>Operatorga qo‘ng‘iroq: {supportPhone}</a>
          </Button>
        )}
      </div>
    </Dialog>
  );
}

// ───────────────────────── Outcome ─────────────────────────

function Outcome({ ride, onClose, onRetry }: { ride: PassengerRide; onClose: () => void; onRetry: () => void }) {
  const qc = useQueryClient();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const rate = useMutation({
    mutationFn: () => api(`/passenger/rides/${ride.id}/rate`, { body: { score, comment: comment.trim() || null } }),
    onSuccess: () => {
      toast.success("Rahmat! Bahoyingiz saqlandi.");
      void qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (ride.status === "NO_DRIVER") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Bo‘sh haydovchi topilmadi</h1>
        <p className="text-sm text-muted">Hozir yaqin atrofda bo‘sh mashina yo‘q. Bir necha daqiqadan so‘ng qayta urinib ko‘ring.</p>
        <div className="flex gap-2">
          <Button variant="outline" block onClick={onClose}>
            Yopish
          </Button>
          <Button block onClick={onRetry}>
            Qayta urinish
          </Button>
        </div>
      </div>
    );
  }
  if (ride.status === "CANCELLED") {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Buyurtma bekor qilindi</h1>
        <p className="text-sm text-muted">{ride.cancelReason ?? "Buyurtma bekor qilindi."}</p>
        <Button block onClick={onClose}>
          Yangi buyurtma
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Safar yakunlandi</h1>
          <p className="mt-0.5 text-sm text-muted">{ride.status === "SETTLED" ? "To‘lov qabul qilindi. Rahmat!" : "Haydovchi to‘lovni tasdiqlashi kutilmoqda."}</p>
        </div>
        <Money amount={ride.finalFare ?? ride.quotedFare} size="lg" />
      </div>
      {!ride.myRating ? (
        <>
          <p className="text-sm font-medium">{ride.driver?.name ?? "Haydovchi"}ni baholang</p>
          <div className="flex justify-between" role="radiogroup" aria-label="Baho">
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} role="radio" aria-checked={score === s} aria-label={`${s} yulduz`} onClick={() => setScore(s)} className="p-1.5">
                <Star className={cn("size-9 transition-colors", s <= score ? "fill-warn text-warn" : "text-border")} />
              </button>
            ))}
          </div>
          {score > 0 && <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={score < 4 ? "Nima yoqmadi?" : "Izoh (ixtiyoriy)"} maxLength={500} className="min-h-16" />}
          <div className="flex gap-2">
            <Button variant="ghost" block onClick={onClose}>
              Keyinroq
            </Button>
            <Button block disabled={score === 0} loading={rate.isPending} onClick={() => rate.mutate()}>
              Baholash
            </Button>
          </div>
        </>
      ) : (
        <Button block onClick={onClose}>
          Yangi buyurtma
        </Button>
      )}
    </div>
  );
}
