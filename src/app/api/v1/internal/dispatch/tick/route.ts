import { timingSafeEqual } from "node:crypto";
import { route, json } from "@/lib/http";
import { env } from "@/lib/env";
import { Errors } from "@/lib/errors";
import { dispatchTick } from "@/features/dispatch/service";

/**
 * Runs one dispatch cycle. For hosts without a long-running process (serverless), call this
 * from an external scheduler every few seconds with `Authorization: Bearer $CRON_SECRET`.
 */
export const POST = route(async (req) => {
  const secret = env().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) throw Errors.unauthenticated();
  return json(await dispatchTick());
});
