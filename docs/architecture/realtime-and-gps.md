# Realtime, GPS and their limits

## Transport

- **Publish**: services call `publish(tx, event)` → `SELECT pg_notify('nt_events', json)` inside the same transaction as the state change. PostgreSQL delivers notifications only after commit.
- **Fan-out**: each server process keeps one `LISTEN nt_events` connection (`src/lib/realtime/hub.ts`) with exponential-backoff reconnect.
- **Delivery**: `GET /api/v1/events?app=passenger|driver|admin` is a Server-Sent Events stream. Every event carries a server-computed `audience` (user IDs, or `staff`); a connection receives only events whose audience contains its user. Passengers therefore receive driver locations **only** for their own active ride.
- **Session re-validation**: the stream re-checks the session every 25 s heartbeat and closes for revoked/blocked users.

Events: `ride.updated`, `ride.offer`, `ride.offer.closed`, `driver.location`, `driver.status`, `incident.created`, `support.updated`.

## State synchronisation

Events are hints, not the source of truth. Clients:
1. refetch all queries on `ready` (connect/reconnect) and `resync` (server lost its LISTEN connection),
2. refetch on the browser `online` event,
3. poll slowly while a ride is active (5–6 s when the stream is down, 15–20 s otherwise),
4. restore the active ride from `GET /passenger/rides/active` / `GET /driver/rides/active` after a refresh.

Missed notifications therefore never leave the UI wrong for longer than one poll interval. All state lives in PostgreSQL; refreshing any page restores it (tested in e2e step 17).

## Scaling notes

- SSE needs a long-running Node process (VPS, Railway, Render, Fly). Serverless platforms with short request limits are not suitable for `/api/v1/events` or the inline worker.
- With N app instances, each holds one LISTEN connection; the dispatch worker elects a single leader through `pg_try_advisory_lock`.
- PostgreSQL `NOTIFY` payloads are capped at 8 KB; events are kept small.

## Driver GPS in a PWA — what works and what does not

| Situation | Behaviour |
|---|---|
| App open, screen on | `watchPosition` updates; the client sends at most one fix per 5 s; the server throttles to ~1 per 2 s and ignores out-of-order fixes. A Screen Wake Lock is requested where supported. |
| Screen off / app in background | **Browsers (especially iOS Safari, and Android Chrome after a short time) suspend JavaScript and geolocation.** No updates are sent. |
| No GPS for 60 s | The driver is excluded from dispatch (stale location). |
| No GPS for 10 min, no active ride | The tick switches the driver offline and notifies them. |
| During an active ride | The ride continues; the passenger sees the last known position with its timestamp. Admins see "GPS eskirgan" in live ops. |

**Do not promise reliable background tracking from the PWA.** Drivers are told in the app to keep it open. For dependable background tracking the next step is a native Android driver app (foreground service with a persistent notification), reusing the same API.

## Push notifications

Not implemented. Web Push would need VAPID keys and a service-worker push handler, and on iOS only works for installed PWAs (16.4+). Offer alerts currently rely on the open app (SSE + vibration). A native driver app or Telegram bot notifications are the practical options.
