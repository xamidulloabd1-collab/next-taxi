import { json } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { adminRoute } from "@/features/admin/guard";
import { deactivateTariff } from "@/features/admin/service";

export const POST = adminRoute<{ id: string }>("tariffs.manage", async (_req, meta, p) => json({ tariff: await deactivateTariff(meta, uuidSchema.parse(p.id)) }));
