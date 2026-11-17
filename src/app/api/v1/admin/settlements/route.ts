import { z } from "zod";
import { json, parseJson } from "@/lib/http";
import { adminRoute } from "@/features/admin/guard";
import { recordSettlement } from "@/features/payments/service";

const schema = z.object({
  driverId: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000_000),
  method: z.enum(["CASH_AT_OFFICE", "BANK_TRANSFER", "CARD_TRANSFER"]),
  reference: z.string().trim().max(100).nullish(),
  note: z.string().trim().max(300).nullish(),
});

export const POST = adminRoute("settlements.manage", async (req, meta) => {
  const r = await recordSettlement(await parseJson(req, schema), { userId: meta.ctx.userId, ip: meta.ip, userAgent: meta.userAgent });
  return json({ settlementId: r.settlement.id, outstandingAfter: r.outstandingAfter }, { status: 201 });
});
