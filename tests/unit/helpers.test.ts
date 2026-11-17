import { describe, expect, it } from "vitest";
import { normalizeUzPhone, maskUzPhone } from "@/lib/phone";
import { isWithinOperatingHours, startOfLocalDay } from "@/lib/time";
import { haversineMeters, validatePolygon } from "@/lib/maps/geo";
import { sniffFileType } from "@/lib/storage";
import { calculateFare } from "@/features/pricing/fare";
import { EstimatedRoutingProvider } from "@/lib/maps/routing";

describe("phone normalisation", () => {
  it("accepts common Uzbek formats", () => {
    expect(normalizeUzPhone("90 123 45 67")).toBe("+998901234567");
    expect(normalizeUzPhone("+998 (93) 123-45-67")).toBe("+998931234567");
    expect(normalizeUzPhone("998771234567")).toBe("+998771234567");
  });
  it("rejects invalid numbers", () => {
    expect(normalizeUzPhone("12345")).toBeNull();
    expect(normalizeUzPhone("+998 10 123 45 67")).toBeNull();
    expect(normalizeUzPhone("+7 912 123 45 67")).toBeNull();
  });
  it("masks phones", () => expect(maskUzPhone("+998901234567")).toBe("+998 90 *** ** 67"));
});

describe("operating hours (Asia/Tashkent)", () => {
  const at = (utc: string) => new Date(utc);
  it("handles a daytime window", () => {
    expect(isWithinOperatingHours(at("2026-11-17T05:00:00Z"), "06:00", "23:00", "Asia/Tashkent")).toBe(true); // 10:00 local
    expect(isWithinOperatingHours(at("2026-11-17T19:30:00Z"), "06:00", "23:00", "Asia/Tashkent")).toBe(false); // 00:30 local
  });
  it("handles overnight windows and 24h", () => {
    expect(isWithinOperatingHours(at("2026-11-17T19:30:00Z"), "18:00", "02:00", "Asia/Tashkent")).toBe(true);
    expect(isWithinOperatingHours(at("2026-11-17T07:00:00Z"), "18:00", "02:00", "Asia/Tashkent")).toBe(false);
    expect(isWithinOperatingHours(at("2026-11-17T07:00:00Z"), "00:00", "00:00", "Asia/Tashkent")).toBe(true);
  });
  it("computes local midnight", () => {
    expect(startOfLocalDay(at("2026-11-17T20:00:00Z"), "Asia/Tashkent").toISOString()).toBe("2026-11-17T19:00:00.000Z");
    expect(startOfLocalDay(at("2026-11-17T10:00:00Z"), "Asia/Tashkent").toISOString()).toBe("2026-11-16T19:00:00.000Z");
  });
});

describe("geo", () => {
  it("haversine ~ 1.11 km per 0.01° latitude", () => {
    const d = haversineMeters({ lat: 38.62, lng: 66.25 }, { lat: 38.63, lng: 66.25 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });
  it("validates polygons", () => {
    expect(validatePolygon({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).not.toBeNull();
    expect(validatePolygon({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] })).toBeNull();
    expect(validatePolygon({ type: "Point", coordinates: [0, 0] })).toBeNull();
    expect(validatePolygon({ type: "Polygon", coordinates: [[[0, 0], [200, 0], [1, 1], [0, 0]]] })).toBeNull();
  });
  it("estimated routing applies detour and speed assumptions", async () => {
    const r = await new EstimatedRoutingProvider().route({ lat: 38.62, lng: 66.25 }, { lat: 38.63, lng: 66.25 });
    expect(r.estimated).toBe(true);
    expect(r.distanceMeters).toBeGreaterThan(1450);
    expect(calculateFare({ baseFare: 0, perKm: 1000, perMinute: 0, minimumFare: 0, roundingStep: 1, commissionBps: 0 }, r.distanceMeters, r.durationSeconds).totalFare).toBe(Math.round(r.distanceMeters));
  });
});

describe("upload sniffing", () => {
  it("detects real file types from magic bytes", () => {
    expect(sniffFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext).toBe("jpg");
    expect(sniffFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))?.ext).toBe("png");
    expect(sniffFileType(new TextEncoder().encode("%PDF-1.7 ..."))?.ext).toBe("pdf");
    expect(sniffFileType(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
  });
});
