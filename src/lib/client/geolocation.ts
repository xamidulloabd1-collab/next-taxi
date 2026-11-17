"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type GeoState =
  | { status: "idle" | "locating" }
  | { status: "ok"; lat: number; lng: number; accuracy: number }
  | { status: "denied" | "unavailable" | "unsupported"; message: string };

const MESSAGES = {
  denied: "Joylashuvga ruxsat berilmagan. Brauzer sozlamalaridan ruxsat bering yoki nuqtani xaritada belgilang.",
  unavailable: "Joylashuvni aniqlab bo‘lmadi. Nuqtani xaritada belgilang.",
  unsupported: "Qurilmangiz joylashuvni aniqlashni qo‘llab-quvvatlamaydi.",
};

/** One-shot position for the passenger (pickup default). */
export function useCurrentPosition() {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) return setState({ status: "unsupported", message: MESSAGES.unsupported });
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => setState({ status: "ok", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setState(e.code === e.PERMISSION_DENIED ? { status: "denied", message: MESSAGES.denied } : { status: "unavailable", message: MESSAGES.unavailable }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }, []);
  return { state, locate };
}

/**
 * Driver GPS reporter: watches position while `active` and sends at most one update per
 * `intervalMs`. Holds a screen wake lock where supported, because browsers suspend GPS for
 * backgrounded PWAs (see docs/architecture/realtime-and-gps.md).
 */
export function useDriverGps(active: boolean, send: (p: { lat: number; lng: number; heading: number | null; speedKmh: number | null; accuracyM: number; recordedAt: string }) => Promise<unknown>, intervalMs = 5000) {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const last = useRef(0);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (!active) return;
    if (!("geolocation" in navigator)) {
      setState({ status: "unsupported", message: MESSAGES.unsupported });
      return;
    }
    setState({ status: "locating" });
    let wakeLock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const requestWake = () => nav.wakeLock?.request("screen").then((l) => (wakeLock = l)).catch(() => undefined);
    void requestWake();
    const onVisible = () => document.visibilityState === "visible" && void requestWake();
    document.addEventListener("visibilitychange", onVisible);

    const id = navigator.geolocation.watchPosition(
      (p) => {
        setState({ status: "ok", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        const now = Date.now();
        if (now - last.current < intervalMs) return;
        last.current = now;
        void sendRef
          .current({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            heading: p.coords.heading != null && Number.isFinite(p.coords.heading) ? p.coords.heading : null,
            speedKmh: p.coords.speed != null && Number.isFinite(p.coords.speed) ? Math.round(p.coords.speed * 3.6) : null,
            accuracyM: Math.round(p.coords.accuracy),
            recordedAt: new Date(p.timestamp).toISOString(),
          })
          .then(() => setLastSentAt(Date.now()))
          .catch(() => undefined);
      },
      (e) => setState(e.code === e.PERMISSION_DENIED ? { status: "denied", message: MESSAGES.denied } : { status: "unavailable", message: MESSAGES.unavailable }),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20_000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLock?.release().catch(() => undefined);
    };
  }, [active, intervalMs]);

  return { state, lastSentAt };
}
