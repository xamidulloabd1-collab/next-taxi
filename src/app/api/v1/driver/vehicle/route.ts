import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { registerVehicle } from "@/features/drivers/service";

const schema = z.object({
  plateNumber: z.string().trim().min(6).max(14),
  make: z.string().trim().min(2).max(40),
  model: z.string().trim().min(1).max(40),
  color: z.string().trim().min(2).max(30),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  seats: z.number().int().min(1).max(8).default(4),
  vehicleClass: z.enum(["ECONOMY", "COMFORT"]).default("ECONOMY"),
});

export const PUT = route(async (req) => {
  const ctx = await requireAuth("driver");
  const vehicle = await registerVehicle(ctx.userId, await parseJson(req, schema));
  return json({ vehicle });
});
