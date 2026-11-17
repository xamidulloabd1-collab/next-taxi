import { Client } from "pg";
import { EventEmitter } from "node:events";
import { logger } from "@/lib/logger";
import { REALTIME_CHANNEL, type RealtimeEvent } from "@/lib/realtime/events";

/**
 * One LISTEN connection per server process fans PostgreSQL notifications out to SSE
 * subscribers. Reconnects with exponential backoff; subscribers are told to resync
 * after a reconnect because notifications sent while disconnected are lost.
 */
class RealtimeHub {
  private client: Client | null = null;
  private emitter = new EventEmitter();
  private connecting: Promise<void> | null = null;
  private backoff = 500;

  constructor() {
    this.emitter.setMaxListeners(10_000);
  }

  async ensureConnected() {
    if (this.client) return;
    if (!this.connecting) this.connecting = this.connect().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async connect() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("notification", (msg) => {
      if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
      try {
        this.emitter.emit("event", JSON.parse(msg.payload) as RealtimeEvent);
      } catch (err) {
        logger.warn("Bad realtime payload", { err });
      }
    });
    client.on("error", (err) => {
      logger.warn("Realtime LISTEN connection error", { err });
      this.handleDisconnect(client);
    });
    client.on("end", () => this.handleDisconnect(client));
    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    this.client = client;
    this.backoff = 500;
  }

  private handleDisconnect(client: Client) {
    if (this.client !== client) return;
    this.client = null;
    this.emitter.emit("resync");
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15_000);
    setTimeout(() => void this.ensureConnected().catch((err) => logger.warn("Realtime reconnect failed", { err })), delay);
  }

  subscribe(audienceKeys: string[], onEvent: (e: RealtimeEvent) => void, onResync: () => void): () => void {
    const keys = new Set(audienceKeys);
    const handler = (e: RealtimeEvent) => {
      if (e.audience.some((a) => keys.has(a))) onEvent(e);
    };
    this.emitter.on("event", handler);
    this.emitter.on("resync", onResync);
    return () => {
      this.emitter.off("event", handler);
      this.emitter.off("resync", onResync);
    };
  }
}

const g = globalThis as unknown as { __ntHub?: RealtimeHub };
export function realtimeHub(): RealtimeHub {
  if (!g.__ntHub) g.__ntHub = new RealtimeHub();
  return g.__ntHub;
}
