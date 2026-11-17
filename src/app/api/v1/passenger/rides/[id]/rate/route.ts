import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { requireAuth } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/validation";
import { rateRide } from "@/features/ratings/service";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAuth("passenger");
  const id = uuidSchema.parse((await params).id);
  const body = await parseJson(req, z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(500).nullish() }));
  const r = await rateRide(ctx.userId, "PASSENGER", id, body.score, body.comment);
  return json({ rating: { score: r.score, comment: r.comment } }, { status: 201 });
});
