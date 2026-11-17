"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker, GeoJSONSource, StyleSpecification } from "maplibre-gl";
import { cn } from "@/components/ui";
import "maplibre-gl/dist/maplibre-gl.css";

export interface LatLng {
  lat: number;
  lng: number;
}
export interface MapPoint extends LatLng {
  id: string;
  kind: "available" | "busy" | "stale" | "pickup";
  label?: string;
}

export interface MapViewProps {
  center: LatLng;
  zoom?: number;
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  driver?: (LatLng & { heading?: number | null }) | null;
  points?: MapPoint[];
  route?: { type: "LineString"; coordinates: [number, number][] } | null;
  zones?: { type: "Polygon"; coordinates: [number, number][][] }[];
  draft?: [number, number][] | null;
  pulsePickup?: boolean;
  dark?: boolean;
  /** Changing this value re-fits the camera to the visible markers/route. */
  fitKey?: string | number;
  onMapClick?: (p: LatLng) => void;
  className?: string;
  interactive?: boolean;
  /** Show zoom buttons (admin/desktop). Phones use pinch zoom. */
  controls?: boolean;
}

const LIGHT_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";
const DARK_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_DARK_URL ?? "https://tiles.openfreemap.org/styles/dark";

/** Used when the tile provider is unreachable: markers and tapping still work. */
function fallbackStyle(dark: boolean): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#111a2c" : "#e9eef4" } }] };
}

function el(html: string, className: string) {
  const d = document.createElement("div");
  d.className = className;
  d.innerHTML = html;
  return d;
}

const PICKUP_HTML = `<span style="position:relative;display:block;width:22px;height:22px">
  <span class="nt-pickup-pulse" style="position:absolute;inset:0;border-radius:9999px;background:#16a34a"></span>
  <span style="position:absolute;inset:3px;border-radius:9999px;background:#16a34a;border:3px solid #fff;box-shadow:0 2px 6px rgba(11,18,32,.35)"></span></span>`;
const DROPOFF_HTML = `<span style="display:block;width:18px;height:18px;border-radius:5px;background:#0b1220;border:3px solid #fff;box-shadow:0 2px 6px rgba(11,18,32,.35)"></span>`;
const CAR_HTML = `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="#0b1220" stroke="#fff" stroke-width="2.5"/><path d="M17 8 L23 23 L17 20 L11 23 Z" fill="#22c55e"/></svg>`;

export function MapView(props: MapViewProps) {
  const { center, zoom = 14, dark = false, className, interactive = true, controls = false } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  const clickRef = useRef(props.onMapClick);
  clickRef.current = props.onMapClick;
  const [ready, setReady] = useState(false);
  const [degraded, setDegraded] = useState(false);

  // Create the map once (maplibre is loaded lazily so non-map pages stay light).
  useEffect(() => {
    let cancelled = false;
    const markerMap = markers.current;
    void (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      libRef.current = lib;
      const map = new lib.Map({
        container: container.current,
        style: dark ? DARK_STYLE : LIGHT_STYLE,
        center: [center.lng, center.lat],
        zoom,
        attributionControl: { compact: true },
        interactive,
        maxPitch: 0,
        dragRotate: false,
        fadeDuration: 0,
      });
      map.touchZoomRotate.disableRotation();
      if (interactive && controls) map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      let styleLoaded = false;
      const onStyleFail = setTimeout(() => {
        if (!styleLoaded) {
          setDegraded(true);
          map.setStyle(fallbackStyle(dark));
        }
      }, 8000);
      map.on("error", (e) => {
        if (!styleLoaded && /style|Failed to fetch|NetworkError|AJAXError/i.test(String(e.error?.message ?? ""))) {
          styleLoaded = true;
          clearTimeout(onStyleFail);
          setDegraded(true);
          map.setStyle(fallbackStyle(dark));
        }
      });
      map.on("style.load", () => {
        styleLoaded = true;
        clearTimeout(onStyleFail);
        ensureLayers(map);
        setReady(true);
      });
      map.on("click", (e) => clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerMap.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // Markers.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready) return;
    const wanted = new Map<string, { pos: LatLng; html: string; cls: string; rotate?: number }>();
    if (props.pickup) wanted.set("pickup", { pos: props.pickup, html: PICKUP_HTML, cls: props.pulsePickup ? "nt-pickup pulsing" : "nt-pickup" });
    if (props.dropoff) wanted.set("dropoff", { pos: props.dropoff, html: DROPOFF_HTML, cls: "" });
    if (props.driver) wanted.set("driver", { pos: props.driver, html: CAR_HTML, cls: "", rotate: props.driver.heading ?? 0 });
    for (const p of props.points ?? []) {
      const color = p.kind === "available" ? "#16a34a" : p.kind === "busy" ? "#d97706" : p.kind === "pickup" ? "#0b1220" : "#94a3b8";
      wanted.set(`pt:${p.id}`, {
        pos: p,
        html: `<span title="${(p.label ?? "").replace(/"/g, "")}" style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
        cls: "",
      });
    }
    for (const [key, m] of markers.current) {
      if (!wanted.has(key)) {
        m.remove();
        markers.current.delete(key);
      }
    }
    for (const [key, w] of wanted) {
      let m = markers.current.get(key);
      if (!m) {
        const node = el(w.html, w.cls);
        m = new lib.Marker({ element: node, rotationAlignment: "map" }).setLngLat([w.pos.lng, w.pos.lat]).addTo(map);
        markers.current.set(key, m);
      } else {
        m.setLngLat([w.pos.lng, w.pos.lat]);
        if (key === "pickup") m.getElement().className = `${w.cls} maplibregl-marker`;
      }
      if (w.rotate !== undefined) m.setRotation(w.rotate);
      const pulse = m.getElement().querySelector(".nt-pickup-pulse");
      if (pulse) pulse.classList.toggle("nt-pulse", key === "pickup" && Boolean(props.pulsePickup));
    }
  }, [ready, props.pickup, props.dropoff, props.driver, props.points, props.pulsePickup]);

  // Route, zones, draft polygon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    ensureLayers(map);
    (map.getSource("nt-route") as GeoJSONSource | undefined)?.setData(
      props.route ? { type: "Feature", properties: {}, geometry: props.route } : { type: "FeatureCollection", features: [] },
    );
    (map.getSource("nt-zones") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (props.zones ?? []).map((g) => ({ type: "Feature", properties: {}, geometry: g })),
    });
    const draft = props.draft ?? [];
    (map.getSource("nt-draft") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [
        ...(draft.length >= 2 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: draft.length >= 3 ? [...draft, draft[0]!] : draft } }] : []),
        ...draft.map((c) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: c } })),
      ],
    });
  }, [ready, props.route, props.zones, props.draft]);

  // Camera fit.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready) return;
    const pts: [number, number][] = [];
    for (const p of [props.pickup, props.dropoff, props.driver]) if (p) pts.push([p.lng, p.lat]);
    if (props.route) pts.push(...props.route.coordinates);
    if (pts.length === 0) {
      map.easeTo({ center: [center.lng, center.lat], zoom, duration: 400 });
      return;
    }
    if (pts.length === 1) {
      map.easeTo({ center: pts[0]!, zoom: Math.max(map.getZoom(), 15), duration: 400 });
      return;
    }
    const b = new lib.LngLatBounds(pts[0]!, pts[0]!);
    for (const p of pts) b.extend(p);
    map.fitBounds(b, { padding: { top: 80, bottom: 300, left: 50, right: 50 }, maxZoom: 16, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.fitKey]);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Inline style: maplibre's stylesheet sets position:relative on the container, which would beat a layered utility class. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {!ready && <div className="absolute inset-0 animate-pulse bg-surface-2" aria-hidden />}
      {degraded && (
        <p className="absolute top-24 left-1/2 z-10 w-max max-w-[85%] -translate-x-1/2 rounded-lg bg-surface/90 px-2.5 py-1.5 text-center text-xs text-muted shadow-sm">
          Xarita qatlamlari yuklanmadi. Nuqtalarni baribir belgilash mumkin.
        </p>
      )}
    </div>
  );
}

function ensureLayers(map: MlMap) {
  if (!map.getSource("nt-zones")) {
    map.addSource("nt-zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "nt-zones-fill", type: "fill", source: "nt-zones", paint: { "fill-color": "#16a34a", "fill-opacity": 0.06 } });
    map.addLayer({ id: "nt-zones-line", type: "line", source: "nt-zones", paint: { "line-color": "#16a34a", "line-width": 1.5, "line-dasharray": [2, 2] } });
  }
  if (!map.getSource("nt-route")) {
    map.addSource("nt-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "nt-route-casing", type: "line", source: "nt-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 8 } });
    map.addLayer({ id: "nt-route-line", type: "line", source: "nt-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0b1220", "line-width": 4.5 } });
  }
  if (!map.getSource("nt-draft")) {
    map.addSource("nt-draft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "nt-draft-line", type: "line", source: "nt-draft", filter: ["==", "$type", "LineString"], paint: { "line-color": "#d97706", "line-width": 2.5 } });
    map.addLayer({ id: "nt-draft-pts", type: "circle", source: "nt-draft", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#d97706", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  }
}
