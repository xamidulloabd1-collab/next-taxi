# NEXT TAXI HTTP API — v1

Base path: `/api/v1`. JSON in, JSON out. Times are ISO-8601 UTC. Money is integer UZS (so‘m).

## Conventions

**Authentication.** Phone + OTP. `POST /auth/otp/verify` sets an httpOnly session cookie per app: `nt_p` (passenger), `nt_d` (driver), `nt_a` (admin). A session works only for its own app's endpoints.

**Errors.** Non-2xx responses have this shape:
```json
{ "error": { "code": "QUOTE_EXPIRED", "message": "Narx muddati tugadi. Narxni qayta hisoblang.", "details": {} } }
```
`message` is user-facing Uzbek text; `code` is stable for clients. Common codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 422, `RATE_LIMITED` 429 (with `Retry-After`), `INVALID_TRANSITION` 409, `RIDE_STATE_CHANGED` 409.

**Idempotency.** `POST /passenger/rides` and `POST /admin/settlements` accept `Idempotency-Key: <8–100 chars>`. A retry with the same key and body replays the stored response (header `idempotent-replay: true`); the same key with a different body returns 422.

**CSRF.** State-changing requests with an `Origin` header must be same-origin.

**Rate limits** (fixed windows, stored in PostgreSQL): OTP 3/10 min and 10/day per phone, 20/h per IP; OTP verify 30/h per IP; quotes 30/min; ride creation 10/5 min; driver GPS ~1 per 2 s; geocoding 30/min; tickets 10/h; SSE connects 30/min.

## Public

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + DB check (`503` when the DB is unreachable) |
| GET | `/cities` | Active cities with centre, zones (GeoJSON), tariffs; feature flags; cancel reasons |
| POST | `/auth/otp/request` | `{ phone, app }` → `{ challengeId, expiresAt, phone, devCode? }` (`devCode` only when `OTP_DEV_ECHO` and not production). Staff numbers only receive codes for `app: "admin"`. |
| POST | `/auth/otp/verify` | `{ challengeId, phone, code, app, fullName? }` → sets the session cookie; creates passenger/driver role and profile on first login |
| POST | `/auth/logout` | `{ app }` |
| GET | `/auth/me?app=` | Current user |
| GET | `/events?app=` | SSE stream (`ready`, `message`, `resync`, `unauthorized`) |
| GET | `/geo/search?q=&lat=&lng=` | Geocoder proxy (passenger/driver session) |
| GET | `/geo/reverse?lat=&lng=` | Reverse geocoding with coordinate fallback |
| POST | `/internal/dispatch/tick` | `Authorization: Bearer $CRON_SECRET`; runs one dispatch cycle |

## Passenger (`nt_p`)

| Method | Path | Description |
|---|---|---|
| GET/PATCH | `/passenger/profile` | Profile, rating, ride count / update name |
| POST | `/passenger/quotes` | `{ pickup:{lat,lng,address?}, dropoff:{…}, vehicleClass? }` → `{ quotes:[{ id, vehicleClass, distanceMeters, durationSeconds, routeGeometry, totalFare, expiresAt, … }] }`. Validates service zones and operating hours; route computed server-side. |
| POST | `/passenger/rides` | `{ quoteId, note?, paymentMethod:"CASH" }` + `Idempotency-Key` → `201 { ride }` in `SEARCHING`; dispatch starts immediately |
| GET | `/passenger/rides?cursor=` | History (cursor pagination) |
| GET | `/passenger/rides/active` | Open ride (incl. `COMPLETED` awaiting cash) or `null` |
| GET | `/passenger/rides/:id` | Ride + timeline. Driver phone/location only while the ride is active. |
| POST | `/passenger/rides/:id/cancel` | `{ reason? }` — allowed until the trip starts |
| POST | `/passenger/rides/:id/rate` | `{ score:1–5, comment? }` once, after completion |
| GET/POST | `/passenger/support/tickets` | List / create `{ category, subject, message, rideId? }` |
| POST | `/passenger/support/tickets/:id/messages` | `{ body }` |
| POST | `/passenger/incidents` | SOS / safety report `{ rideId?, description, severity?, lat?, lng? }` |

## Driver (`nt_d`)

| Method | Path | Description |
|---|---|---|
| GET/PUT | `/driver/profile` | Overview (status, documents, vehicle, debt) / `{ fullName, cityId, licenseNumber, licenseExpiry }` |
| PUT | `/driver/vehicle` | `{ plateNumber, make, model, color, year, seats, vehicleClass }` → needs review |
| POST | `/driver/documents` | multipart `type` + `file` (JPG/PNG/WEBP/PDF ≤ 6 MB, sniffed by magic bytes) |
| GET | `/driver/documents/:id` | Own document file only |
| POST | `/driver/submit` | Submit the application for review (validates completeness) |
| POST | `/driver/availability` | `{ online }` — requires approval, approved vehicle, active city, valid licence, debt ≤ limit |
| POST | `/driver/location` | `{ lat, lng, heading?, speedKmh?, accuracyM?, recordedAt? }` → `{ accepted }` |
| GET | `/driver/offers/current` | Pending offer + `serverTime` (for countdown clock-skew correction) |
| POST | `/driver/offers/:id/accept` | Atomic assignment; `409 RIDE_UNAVAILABLE` / `OFFER_EXPIRED` / `DRIVER_BUSY` |
| POST | `/driver/offers/:id/reject` | Moves dispatch to the next driver |
| GET | `/driver/rides/active` · `/driver/rides` · `/driver/rides/:id` | Active ride / history / detail |
| POST | `/driver/rides/:id/action` | `{ action: "en-route" \| "arrived" \| "start" \| "complete" \| "cash-confirm" }` or `{ action:"cancel", reason:"PASSENGER_NO_SHOW" \| "VEHICLE_PROBLEM" \| "CANNOT_REACH" \| "OTHER" }`. `arrived` is GPS-validated (≤ `arrival_radius_meters`); no-show needs ≥ 3 min waiting. |
| POST | `/driver/rides/:id/rate` | Rate the passenger |
| GET | `/driver/earnings` | Today, last 7 days, outstanding commission, settlements |
| … | `/driver/support/*`, `/driver/incidents` | Same as passenger |

## Admin (`nt_a`) — every route checks a permission server-side

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/live` | `rides.view` |
| POST | `/admin/rides/:id/action` `{ action: cancel\|complete\|confirm-cash, reason }` | `rides.manage` |
| POST | `/admin/drivers/:id/decision` `{ decision: APPROVE\|REJECT, reason? }` | `drivers.verify` |
| POST | `/admin/drivers/:id/suspension` `{ suspend, reason? }` | `drivers.manage` |
| POST | `/admin/documents/:id/review` `{ status, reason? }` | `drivers.verify` |
| GET | `/admin/documents/:id/file` (audited) | `documents.view` |
| POST | `/admin/vehicles/:id/review` | `vehicles.verify` |
| POST | `/admin/users/:id/block` `{ blocked, reason }` | `passengers.manage` |
| POST | `/admin/users/:id/anonymize` (account deletion) | `staff.manage` |
| PATCH | `/admin/cities/:id` (activation validates centre + zone + tariff) | `cities.manage` (+ city scope) |
| POST | `/admin/zones` `{ id?, cityId, name, boundary: GeoJSON Polygon, isActive, note? }` | `cities.manage` |
| POST | `/admin/tariffs` (publishes a new version) · `/admin/tariffs/:id/deactivate` | `tariffs.manage` |
| POST | `/admin/settlements` `{ driverId, amount, method, reference?, note? }` | `settlements.manage` |
| GET | `/admin/reconcile` | `finance.view` |
| POST | `/admin/support/:id/reply` `{ body, status? }` | `support.manage` |
| PATCH | `/admin/incidents/:id` `{ status, resolution? }` | `incidents.manage` |
| PATCH | `/admin/settings` `{ key, value }` | `settings.manage` |
| POST/DELETE | `/admin/staff` | `staff.manage` |

Role → permission matrix: `src/lib/permissions/index.ts`.
