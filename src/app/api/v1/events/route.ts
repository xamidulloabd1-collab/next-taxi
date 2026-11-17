import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAuth, resolveSessionToken, SESSION_COOKIES } from "@/lib/auth/session";
import { appSchema } from "@/lib/validation";
import { errorResponse } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { realtimeHub } from "@/lib/realtime/hub";
import { STAFF_AUDIENCE, type RealtimeEvent } from "@/lib/realtime/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream. Each connection only receives events whose server-computed
 * audience contains the authenticated user (or "staff" for admin sessions). The session is
 * re-validated on every heartbeat so revoked/blocked users are disconnected.
 * Clients refetch state on `ready` and `resync` to recover from missed events.
 */
export async function GET(req: NextRequest) {
  try {
    const app = appSchema.parse(req.nextUrl.searchParams.get("app"));
    const ctx = await getAuth(app);
    if (!ctx) throw Errors.unauthenticated();
    await enforceRateLimit(`sse:${ctx.userId}`, 30, 60);
    const token = (await cookies()).get(SESSION_COOKIES[app])?.value ?? "";
    await realtimeHub().ensureConnected();

    const audience = app === "admin" ? [ctx.userId, STAFF_AUDIENCE] : [ctx.userId];
    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            cleanup();
          }
        };
        send("ready", { at: new Date().toISOString() });
        const unsubscribe = realtimeHub().subscribe(
          audience,
          (e: RealtimeEvent) => send("message", e),
          () => send("resync", { at: new Date().toISOString() }),
        );
        const heartbeat = setInterval(async () => {
          if (!(await resolveSessionToken(token, app))) {
            send("unauthorized", {});
            cleanup();
            return;
          }
          if (!closed) {
            try {
              controller.enqueue(encoder.encode(`: ping\n\n`));
            } catch {
              cleanup();
            }
          }
        }, 25_000);
        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        req.signal.addEventListener("abort", () => cleanup());
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
