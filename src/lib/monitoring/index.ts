import { logger } from "@/lib/logger";

/**
 * Error monitoring adapter. Always writes a structured log line; when ERROR_WEBHOOK_URL is set,
 * also POSTs a compact JSON alert (works with Slack/Discord-compatible webhooks or a Telegram relay).
 * Swap in Sentry by implementing `reportError` with `@sentry/nextjs` if/when budget allows.
 */
const recent = new Map<string, number>();

export function reportError(err: unknown, context: Record<string, unknown> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  logger.error(e.message, { err: e, ...context });

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  // De-duplicate identical alerts for 60 s to avoid flooding during incidents.
  const key = `${e.name}:${e.message}`.slice(0, 200);
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 60_000) return;
  recent.set(key, now);
  if (recent.size > 500) recent.clear();

  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `[NEXT TAXI] ${e.name}: ${e.message}`.slice(0, 1500), context: Object.keys(context) }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
}
