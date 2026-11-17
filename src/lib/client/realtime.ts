"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

export interface LiveLocation {
  rideId: string;
  lat: number;
  lng: number;
  heading: number | null;
  recordedAt: string;
}

/** Latest driver position pushed over SSE (passenger app). */
export const useLiveLocation = create<{ loc: LiveLocation | null; set: (l: LiveLocation | null) => void }>((set) => ({
  loc: null,
  set: (loc) => set({ loc }),
}));

interface ServerEvent {
  type: string;
  rideId?: string;
  status?: string;
  data?: Record<string, unknown>;
}

/**
 * Subscribes to /api/v1/events. On connect and on server "resync" every query is refetched,
 * so state is correct after reconnects. EventSource reconnects automatically; while it is down,
 * pages also poll at a slow interval (see refetchInterval in each query).
 */
export function useRealtime(app: "passenger" | "driver" | "admin", onEvent?: (e: ServerEvent) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const open = () => {
      es = new EventSource(`/api/v1/events?app=${app}`);
      es.addEventListener("ready", () => {
        setConnected(true);
        void qc.invalidateQueries();
      });
      es.addEventListener("resync", () => void qc.invalidateQueries());
      es.addEventListener("unauthorized", () => {
        es?.close();
        window.location.href = `/${app}/login`;
      });
      es.addEventListener("message", (m) => {
        try {
          const e = JSON.parse((m as MessageEvent).data) as ServerEvent;
          if (e.type === "driver.location" && e.rideId && e.data) {
            useLiveLocation.getState().set({ rideId: e.rideId, lat: Number(e.data.lat), lng: Number(e.data.lng), heading: (e.data.heading as number | null) ?? null, recordedAt: String(e.data.recordedAt) });
          } else {
            void qc.invalidateQueries();
          }
          handler.current?.(e);
        } catch {
          /* ignore malformed */
        }
      });
      es.onerror = () => {
        setConnected(false);
        if (es?.readyState === EventSource.CLOSED && !closed) {
          retry = setTimeout(open, 3000);
        }
      };
    };
    open();
    const onOnline = () => void qc.invalidateQueries();
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
      window.removeEventListener("online", onOnline);
    };
  }, [app, qc]);

  return { connected };
}
