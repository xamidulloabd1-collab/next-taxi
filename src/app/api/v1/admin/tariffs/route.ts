import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { adminRoute } from "@/features/admin/guard";
import { publishTariffVersion } from "@/features/admin/service";

const money = z.number().int().min(0).max(10_000_000);
const schema = z.object({
  cityId: z.string().uuid(),
  vehicleClass: z.enum(["ECONOMY", "COMFORT"]),
  name: z.string().trim().min(2).max(60),
  baseFare: money,
  perKm: money,
  perMinute: money,
  minimumFare: money,
  roundingStep: z.number().int().min(1).max(10_000),
  commissionBps: z.number().int().min(0).max(5000),
  quoteTtlSeconds: z.number().int().min(30).max(3600),
});

/** Publishes a new tariff version (the current version is retired, not edited). */
export const POST = adminRoute("tariffs.manage", async (req, meta) => {
  return json({ tariff: await publishTariffVersion(meta, await parseJson(req, schema)) }, { status: 201 });
});
