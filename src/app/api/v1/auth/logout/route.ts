import { z } from "zod";
import { route, json, parseJson } from "@/lib/http";
import { revokeSession } from "@/lib/auth/session";
import { appSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  const { app } = await parseJson(req, z.object({ app: appSchema }));
  await revokeSession(app);
  return json({ ok: true });
});
