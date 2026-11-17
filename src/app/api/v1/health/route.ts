import { db } from "@/lib/db/prisma";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Liveness + database readiness probe for uptime monitoring. */
export async function GET() {
  const started = Date.now();
  try {
    await db().$queryRaw`SELECT 1`;
    return json({ status: "ok", db: "ok", latencyMs: Date.now() - started, time: new Date().toISOString() });
  } catch {
    return json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
