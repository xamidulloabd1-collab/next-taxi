import { Client } from "pg";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/monitoring";
import { dispatchTick } from "@/features/dispatch/service";
import { purgeExpiredRateLimits } from "@/lib/rate-limit";

const LEADER_LOCK = 727_002;

/**
 * Background dispatch loop. Several app instances may run it; a PostgreSQL session-level
 * advisory lock elects one leader so ticks are not duplicated (duplicates would still be safe).
 */
export function startDispatchWorker(intervalMs = Number(process.env.DISPATCH_TICK_MS ?? 2000)) {
  const g = globalThis as unknown as { __ntWorker?: NodeJS.Timeout };
  if (g.__ntWorker) return () => undefined;

  let client: Client | null = null;
  let leader = false;
  let running = false;
  let ticks = 0;

  async function ensureLeader(): Promise<boolean> {
    if (leader && client) return true;
    try {
      if (!client) {
        const c = new Client({ connectionString: process.env.DATABASE_URL });
        c.on("error", (err) => {
          logger.warn("Dispatch worker connection lost", { err });
          leader = false;
          client = null;
        });
        await c.connect();
        client = c;
      }
      const r = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LEADER_LOCK]);
      leader = Boolean(r.rows[0]?.ok);
      if (leader) logger.info("Dispatch worker is leader", { intervalMs });
    } catch (err) {
      logger.warn("Dispatch worker could not acquire leadership", { err });
      leader = false;
      await client?.end().catch(() => undefined);
      client = null;
    }
    return leader;
  }

  g.__ntWorker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (!(await ensureLeader())) return;
      const r = await dispatchTick();
      if (r.expired || r.searched || r.offline) logger.debug("dispatch tick", r);
      if (++ticks % 1800 === 0) await purgeExpiredRateLimits();
    } catch (err) {
      reportError(err, { where: "dispatchWorker" });
    } finally {
      running = false;
    }
  }, intervalMs);

  return () => {
    if (g.__ntWorker) clearInterval(g.__ntWorker);
    g.__ntWorker = undefined;
    void client?.end().catch(() => undefined);
  };
}
