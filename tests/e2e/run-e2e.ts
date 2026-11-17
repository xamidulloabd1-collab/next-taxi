/**
 * End-to-end acceptance test over real HTTP (cookies, SSE, route handlers, PostgreSQL/PostGIS).
 * Covers the MVP acceptance workflow (section 20 of the brief) plus authorisation checks.
 *
 *   npm run build && npm run test:e2e   # fresh e2e DB + dev seed, boots the production build (APP_ENV=staging) on :3100
 *   E2E_MODE=dev npm run test:e2e        # same, but against `next dev`
 *   E2E_BASE_URL=http://host npm run test:e2e   # run against an already running dev/staging server
 *
 * Requires OTP_DEV_ECHO=true on the target server (never in production).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resetDatabase } from "../../scripts/db-reset";
import { ensureDatabase, testDatabaseUrl } from "../helpers/test-db";

const PORT = 3100;
const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
// Same server as DATABASE_URL in .env (or E2E_DATABASE_URL), separate `nexttaxi_e2e` database.
const E2E_DB = process.env.E2E_DATABASE_URL ?? testDatabaseUrl("nexttaxi_e2e");
const CENTER = { lat: 38.62083, lng: 66.24806 };

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
  }
}

class Actor {
  cookies = new Map<string, string>();
  constructor(public readonly name: string) {}
  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), cookie: this.cookieHeader(), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair!.split("=");
      if (k && v !== undefined) this.cookies.set(k.trim(), v);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }
  async login(phone: string, app: "passenger" | "driver" | "admin") {
    const r1 = await this.req<{ challengeId: string; devCode?: string }>("POST", "/auth/otp/request", { phone, app });
    if (r1.status !== 200 || !r1.body.devCode) throw new Error(`OTP request failed for ${this.name}: ${r1.status} ${JSON.stringify(r1.body)}`);
    const r2 = await this.req("POST", "/auth/otp/verify", { challengeId: r1.body.challengeId, phone, code: r1.body.devCode, app });
    if (r2.status !== 200) throw new Error(`OTP verify failed for ${this.name}: ${r2.status} ${JSON.stringify(r2.body)}`);
  }
  /** Opens an SSE stream and collects events until closed. */
  openEvents(app: string) {
    const events: { event: string; data: unknown }[] = [];
    const ctrl = new AbortController();
    const ready = (async () => {
      const res = await fetch(`${BASE}/api/v1/events?app=${app}`, { headers: { cookie: this.cookieHeader() }, signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const ev = chunk.match(/^event: (.*)$/m)?.[1];
              const data = chunk.match(/^data: (.*)$/m)?.[1];
              if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
            }
          }
        } catch {
          /* aborted */
        }
      })();
      return res.status;
    })();
    return { events, ready, close: () => ctrl.abort() };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 15_000, every = 400): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

async function prepareDatabase() {
  await ensureDatabase(E2E_DB);
  await resetDatabase(E2E_DB);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("npx", ["tsx", "prisma/seed-dev.ts"], { env: { ...process.env, DATABASE_URL: E2E_DB, NODE_ENV: "development" }, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed-dev exited ${code}`))));
  });
}

async function startServer(): Promise<ChildProcess> {
  const useBuild = process.env.E2E_MODE !== "dev";
  const env = {
    ...process.env,
    NODE_ENV: (useBuild ? "production" : "development") as "production" | "development",
    APP_ENV: "staging",
    PORT: String(PORT),
    DATABASE_URL: E2E_DB,
    AUTH_SECRET: "e2e-secret-0123456789abcdef0123456789",
    OTP_DEV_ECHO: "true",
    SMS_PROVIDER: "console",
    ROUTING_PROVIDER: "estimate",
    GEOCODING_PROVIDER: "none",
    DISPATCH_WORKER: "inline",
    DISPATCH_TICK_MS: "1000",
    STORAGE_LOCAL_DIR: "./storage/e2e",
    CRON_SECRET: "e2e-cron-secret-0123456789abcdef",
  };
  // Default: test the optimized production build (`npm run build` first). E2E_MODE=dev uses `next dev`.
  const proc = spawn("npx", ["next", useBuild ? "start" : "dev", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  proc.stdout?.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  proc.stderr?.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  const up = await waitFor(async () => {
    try {
      const r = await fetch(`${BASE}/api/v1/health`);
      return r.ok;
    } catch {
      return false;
    }
  }, 120_000, 1000);
  if (!up) throw new Error("Server did not start");
  return proc;
}

async function main() {
  let server: ChildProcess | null = null;
  if (!process.env.E2E_BASE_URL) {
    console.log("Preparing e2e database…");
    await prepareDatabase();
    console.log("Starting Next.js dev server…");
    server = await startServer();
  }
  const started = Date.now();
  try {
    const passenger = new Actor("passenger");
    const driver = new Actor("driver");
    const admin = new Actor("admin");
    const outsider = new Actor("outsider");
    const passengerPhone = `+99893${String(Date.now()).slice(-7)}`;

    console.log("\n1. Authentication");
    await passenger.login(passengerPhone, "passenger");
    check("passenger authenticated via OTP (session cookie set)", passenger.cookies.has("nt_p"));
    await driver.login("+998902222221", "driver");
    check("approved driver authenticated", driver.cookies.has("nt_d"));
    await admin.login("+998900000001", "admin");
    check("admin authenticated", admin.cookies.has("nt_a"));
    await outsider.login(`+99894${String(Date.now()).slice(-7)}`, "passenger");
    const deniedAdmin = await outsider.req("POST", "/auth/otp/request", { phone: "+998941234567", app: "admin" });
    check("admin OTP request for non-staff number sends no code", deniedAdmin.status === 200 && !("devCode" in (deniedAdmin.body as object)));

    console.log("\n   Driver goes online");
    await driver.req("POST", "/driver/location", { lat: CENTER.lat + 0.004, lng: CENTER.lng + 0.003, accuracyM: 8 });
    const online = await driver.req<{ availability: string }>("POST", "/driver/availability", { online: true });
    check("driver online", online.body.availability === "ONLINE", online.body);

    console.log("\n2–3. Pickup/destination and server-side quote");
    const pickup = { lat: CENTER.lat + 0.001, lng: CENTER.lng + 0.001, address: "E2E olib ketish" };
    const dropoff = { lat: CENTER.lat - 0.012, lng: CENTER.lng + 0.01, address: "E2E manzil" };
    const q = await passenger.req<{ quotes: { id: string; totalFare: number; vehicleClass: string }[] }>("POST", "/passenger/quotes", { pickup, dropoff, totalFare: 1 });
    const economy = q.body.quotes?.find((x) => x.vehicleClass === "ECONOMY");
    check("quote created by backend (client-sent fare ignored)", q.status === 201 && economy && economy.totalFare > 1000, q.body);
    const outside = await passenger.req<{ error: { code: string } }>("POST", "/passenger/quotes", { pickup: { lat: CENTER.lat + 0.3, lng: CENTER.lng }, dropoff });
    check("pickup outside service zone rejected", outside.body.error?.code === "PICKUP_OUT_OF_AREA", outside.body);

    console.log("\n4. Passenger confirms ride (idempotent)");
    const sse = passenger.openEvents("passenger");
    check("SSE stream opened", (await sse.ready) === 200);
    const key = randomUUID();
    const book1 = await passenger.req<{ ride: { id: string; status: string; code: string } }>("POST", "/passenger/rides", { quoteId: economy!.id }, { "idempotency-key": key });
    const book2 = await passenger.req<{ ride: { id: string } }>("POST", "/passenger/rides", { quoteId: economy!.id }, { "idempotency-key": key });
    check("ride created in SEARCHING", book1.status === 201 && book1.body.ride?.status === "SEARCHING", book1.body);
    check("retry with same Idempotency-Key replays the same ride", book2.body.ride?.id === book1.body.ride.id && book2.headers.get("idempotent-replay") === "true");
    const rideId = book1.body.ride.id;

    console.log("\n5–7. Dispatch, offer, acceptance");
    const offer = await waitFor(async () => {
      const r = await driver.req<{ offer: { id: string; rideId: string; fare: number } | null }>("GET", "/driver/offers/current");
      return r.body.offer?.rideId === rideId ? r.body.offer : null;
    });
    check("backend found the eligible driver and sent an offer", Boolean(offer));
    check("offer shows the server-calculated fare", offer?.fare === economy!.totalFare);
    const acc = await driver.req<{ ride: { status: string } }>("POST", `/driver/offers/${offer!.id}/accept`);
    check("driver accepted → ASSIGNED", acc.body.ride?.status === "ASSIGNED", acc.body);
    const accAgain = await driver.req<{ error: { code: string } }>("POST", `/driver/offers/${offer!.id}/accept`);
    check("second accept of the same offer is rejected", accAgain.status === 409, accAgain.body);

    console.log("\n8. Passenger sees the assigned driver");
    const view = await passenger.req<{ ride: { status: string; driver: { name: string; phone: string | null } | null; vehicle: { plateNumber: string } | null } }>("GET", "/passenger/rides/active");
    check("passenger sees driver and vehicle plate", Boolean(view.body.ride?.driver?.name && view.body.ride?.vehicle?.plateNumber), view.body);
    const gotAssignedEvent = await waitFor(async () => sse.events.find((e) => e.event === "message" && (e.data as { status?: string }).status === "ASSIGNED"), 8000);
    check("passenger received realtime ride.updated(ASSIGNED) over SSE", Boolean(gotAssignedEvent), sse.events.map((e) => e.event));

    console.log("\n   Authorisation boundaries");
    const strangerView = await outsider.req("GET", `/passenger/rides/${rideId}`);
    check("another passenger cannot read the ride (404)", strangerView.status === 404);
    const driverOnPassengerApi = await driver.req("GET", `/passenger/rides/${rideId}`);
    check("driver session cannot use passenger API (401)", driverOnPassengerApi.status === 401);
    const passengerOnAdmin = await passenger.req("GET", "/admin/live");
    check("passenger session cannot use admin API (401)", passengerOnAdmin.status === 401);
    const anonSse = await fetch(`${BASE}/api/v1/events?app=passenger`);
    check("unauthenticated SSE subscription rejected", anonSse.status === 401);
    const outsiderSse = outsider.openEvents("passenger");
    await outsiderSse.ready;

    console.log("\n9–11. Arrival, start, completion");
    const enRoute = await driver.req<{ ride: { status: string } }>("POST", `/driver/rides/${rideId}/action`, { action: "en-route" });
    check("driver en route → ARRIVING", enRoute.body.ride?.status === "ARRIVING", enRoute.body);
    await sleep(2200); // location updates are throttled server-side
    const loc = await driver.req<{ accepted: boolean }>("POST", "/driver/location", { lat: pickup.lat + 0.0004, lng: pickup.lng, heading: 90, accuracyM: 6 });
    check("driver location accepted", loc.body.accepted === true, loc.body);
    const liveLoc = await waitFor(async () => sse.events.find((e) => (e.data as { type?: string }).type === "driver.location"), 6000);
    check("passenger received live driver location over SSE", Boolean(liveLoc));
    const arrived = await driver.req<{ ride: { status: string } }>("POST", `/driver/rides/${rideId}/action`, { action: "arrived" });
    check("driver reached pickup → ARRIVED", arrived.body.ride?.status === "ARRIVED", arrived.body);
    const started2 = await driver.req<{ ride: { status: string } }>("POST", `/driver/rides/${rideId}/action`, { action: "start" });
    check("driver started ride → IN_PROGRESS", started2.body.ride?.status === "IN_PROGRESS", started2.body);
    const cancelInTrip = await passenger.req("POST", `/passenger/rides/${rideId}/cancel`, { reason: "test" });
    check("passenger cannot cancel during the trip", cancelInTrip.status === 409);
    const completed = await driver.req<{ ride: { status: string; finalFare: number; commissionAmount: number; driverEarnings: number } }>("POST", `/driver/rides/${rideId}/action`, { action: "complete" });
    check("driver completed ride → COMPLETED", completed.body.ride?.status === "COMPLETED", completed.body);

    console.log("\n12–13. Cash payment and commission");
    const settled = await driver.req<{ ride: { status: string; finalFare: number; commissionAmount: number; driverEarnings: number } }>("POST", `/driver/rides/${rideId}/action`, { action: "cash-confirm" });
    const s = settled.body.ride;
    check("cash recorded → SETTLED", s?.status === "SETTLED", settled.body);
    check("commission = 10% of fare (example tariff)", s && s.commissionAmount === Math.round(s.finalFare * 0.1), s);
    check("driver earnings = fare − commission", s && s.driverEarnings === s.finalFare - s.commissionAmount, s);

    console.log("\n14–15. History and earnings");
    const hist = await passenger.req<{ items: { id: string; status: string }[] }>("GET", "/passenger/rides");
    check("ride appears in passenger history as SETTLED", hist.body.items?.[0]?.id === rideId && hist.body.items[0]!.status === "SETTLED");
    const rate = await passenger.req("POST", `/passenger/rides/${rideId}/rate`, { score: 5, comment: "E2E" });
    check("passenger rated the driver", rate.status === 201);
    const earn = await driver.req<{ today: { rides: number; net: number }; outstandingCommission: number }>("GET", "/driver/earnings");
    check("driver daily earnings updated", earn.body.today?.rides >= 1 && earn.body.today.net >= (s?.driverEarnings ?? 0), earn.body);
    check("driver commission debt recorded", earn.body.outstandingCommission >= (s?.commissionAmount ?? 1), earn.body);

    console.log("\n16. Admin sees the completed ride");
    const adminPage = await fetch(`${BASE}/admin/rides/${rideId}`, { headers: { cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
    const html = await adminPage.text();
    check("admin ride page renders with the ride code", adminPage.status === 200 && html.includes(book1.body.ride.code));
    const recon = await admin.req<{ issues: unknown[] }>("GET", "/admin/reconcile");
    check("finance reconciliation reports no discrepancies", recon.status === 200 && recon.body.issues?.length === 0, recon.body);
    const settle = await admin.req<{ outstandingAfter: number }>("POST", "/admin/settlements", { driverId: (await driverProfileId(driver)) ?? "", amount: s!.commissionAmount, method: "CASH_AT_OFFICE", reference: "E2E-1" });
    check("finance recorded the driver's commission settlement", settle.status === 201, settle.body);

    console.log("\n17. Persistence after refresh");
    const fresh = new Actor("passenger-refresh");
    fresh.cookies = new Map(passenger.cookies);
    const after = await fresh.req<{ ride: { status: string; myRating: { score: number } | null }; timeline: { status: string }[] }>("GET", `/passenger/rides/${rideId}`);
    check("ride state, rating and full timeline persist", after.body.ride?.status === "SETTLED" && after.body.ride.myRating?.score === 5 && after.body.timeline.length === 8, after.body.timeline);
    check("unrelated passenger received no events for this ride", !outsiderSse.events.some((e) => (e.data as { rideId?: string }).rideId === rideId));

    console.log("\n   Role-based admin restrictions");
    const grant = await admin.req("POST", "/admin/staff", { phone: "+998977777777", role: "SUPPORT_OPERATOR", fullName: "E2E Operator" });
    check("super admin granted a support role", grant.status === 201, grant.body);
    const support = new Actor("support");
    await support.login("+998977777777", "admin");
    const tariffAttempt = await support.req("POST", "/admin/tariffs", { cityId: randomUUID(), vehicleClass: "ECONOMY", name: "x", baseFare: 1, perKm: 1, perMinute: 1, minimumFare: 1, roundingStep: 1, commissionBps: 1, quoteTtlSeconds: 60 });
    check("support operator cannot publish tariffs (403)", tariffAttempt.status === 403);
    const settleAttempt = await support.req("POST", "/admin/settlements", { driverId: randomUUID(), amount: 1, method: "CASH_AT_OFFICE" });
    check("support operator cannot record settlements (403)", settleAttempt.status === 403);
    const liveOk = await support.req("GET", "/admin/live");
    check("support operator can view live rides", liveOk.status === 200);

    sse.close();
    outsiderSse.close();
  } finally {
    console.log(`\n${passed} passed, ${failures.length} failed (${Math.round((Date.now() - started) / 1000)} s)`);
    if (failures.length) console.log(`Failed:\n - ${failures.join("\n - ")}`);
    // Kill the whole process group (npx → next → next-server).
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  }
  process.exit(failures.length ? 1 : 0);
}

async function driverProfileId(driver: Actor) {
  const r = await driver.req<{ driver: { userId: string } }>("GET", "/driver/profile");
  return r.body.driver?.userId;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
