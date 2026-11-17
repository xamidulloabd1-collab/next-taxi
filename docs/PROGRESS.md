# NEXT TAXI — Development progress report (v0.1)

Date: 17 November 2026 · Environment: Ubuntu 24.04, Node 22, PostgreSQL 16.15 + PostGIS 3.4.2, headless Chrome.

## 1. Verdict

**The core MVP acceptance workflow (brief §20, steps 1–17) passes over real HTTP against the optimised production build and a real PostgreSQL/PostGIS database**, including the critical authorisation, concurrency and financial tests. **Commercial launch readiness is a separate milestone and is not met** — see [pilot-readiness.md](pilot-readiness.md) for the 10 blockers (legal, SMS provider, routing server, verified zone, tariffs, real-device testing).

## 2. Test results (all executed in this environment)

| Suite | Command | Result |
|---|---|---|
| TypeScript strict | `npm run typecheck` | ✅ 0 errors |
| ESLint (next/core-web-vitals + typescript) | `npm run lint` | ✅ 0 problems |
| Unit tests | `npm test` (tests/unit) | ✅ 31 / 31 |
| Integration tests on PostgreSQL + PostGIS | `npm test` (tests/integration) | ✅ 48 / 48 |
| Production build | `next build` | ✅ |
| HTTP end-to-end acceptance (production build, `APP_ENV=staging`) | `npm run test:e2e` | ✅ 43 / 43 checks |
| Browser smoke tests (Playwright, headless Chrome) | `npm run test:ui` | ✅ 4 / 4 |

**Covered by the integration tests:** OTP hashing, single use, attempt limits (including parallel guessing) and rate limits; app-bound sessions, expiry, blocking; fare maths; zone and operating-hour validation; booking rules (expired, foreign or reused quotes); the full lifecycle with history, payment, commission and ratings; GPS-validated arrival; passenger, driver and no-show cancellation; re-dispatch; NO_DRIVER by timeout and by offer limit; eligibility filters (unapproved, offline, stale GPS, out of radius, wrong class, commission debt).

**Concurrency tests:**
- 3 drivers accepting simultaneously → exactly 1 assignment.
- Double-tap accept → 1.
- Accept racing a cancel, 5 iterations → consistent outcome every time.
- 6 parallel bookings with one quote → 1 ride.
- 4 parallel bookings with different quotes → 1 active ride.
- A driver can never hold 2 active rides (database guarantee).
- 6 parallel dispatch runs → 1 pending offer.

**Finance tests:** balanced accrual posted exactly once; ledger immutability and the balance trigger; settlements capped at the outstanding amount, including concurrently; reconciliation empty.

**Admin and privacy tests:** RBAC, city-manager scoping, city-activation rules, tariff versioning with locked quote prices, invalid-polygon rejection, retention purge, account anonymisation.

## 3. Measured performance (this machine, not production hardware)

| Measurement | Result |
|---|---|
| Dispatch candidate query, 2,000 online drivers within 5 km | **38 ms** after the rewrite (was 1,229 ms; the plan underestimated the spatial filter) |
| `POST /passenger/quotes` (estimated routing), n = 25 | p50 20 ms · p95 29 ms |
| `GET /passenger/rides/active`, n = 25 | p50 16 ms · p95 47 ms |
| `GET /cities`, n = 25 | p50 6 ms · p95 12 ms |
| First-load JS (shared + page) | passenger 153 kB · driver 156 kB · admin pages ~108–136 kB (uncompressed, from `next build`) |
| MapLibre chunk (lazy-loaded on map pages only) | 266 KB gzip |
| Full e2e workflow over HTTP | 4 s |

Not measured: real phones, 3G networks, battery drain, memory over long sessions. See the real-device plan in pilot-readiness §C.

## 4. Milestone status

| Milestone | Status | Notes |
|---|---|---|
| 1 Foundation | ✅ Done | Strict TS, Tailwind 4 design system, Prisma schema (29 tables), generated + PostGIS/integrity migrations, OTP auth, sessions, RBAC, env validation |
| 2 Passenger | ✅ Done | Map (MapLibre), GPS/tap pickup + destination, server quotes per class, booking, live states, SOS, rating, history, support, profile |
| 3 Driver | ✅ Done | Onboarding with document upload + review flow, availability gates, GPS reporter + wake lock, expiring offers |
| 4 Dispatch & realtime | ✅ Done | PostGIS candidate search + ETA ranking, batch offers, atomic acceptance, SSE via LISTEN/NOTIFY, reconnect resync, polling fallback |
| 5 Completion & money | ✅ Done | Arrival validation, start/complete, cash confirmation, commission, append-only double-entry ledger, settlements, reconciliation, earnings |
| 6 Administration | ✅ Done | 14 sections + detail pages; server-side permission checks; audit log |
| 7 Quality & security | ✅ Done (software) | Test suites above; security checklist; structured logs; error webhook; retention job. Pen test pending. |
| 8 Pilot preparation | 🟡 Partly done | G‘uzor configuration (placeholder zone), deployment docs, checklists, cost estimate. **Blocked:** real devices, SMS contract, OSRM server, legal review. |

## 5. Completed / pending / blocked

**Completed:** every deliverable in brief §19. That is source code, all three interfaces, schema, migrations, dev seed, API docs, env template, Docker, automated tests, deployment guide, security checklist, pilot checklist, architecture docs, known limitations, launch blockers, this report, and the archive.

**Pending (engineering):**
- Click/Payme adapters (need contracts)
- Web push / native Android driver app for background GPS and offer alerts
- Number masking
- Russian/English copy (the structure is i18n-ready, but strings are not extracted)
- Nonce-based CSP
- React Hook Form on the remaining forms (support uses RHF + Zod; the others use controlled state with server-side Zod)
- Support-ticket retention enforcement
- Admin CSV exports
- Load test with realistic traffic

**Blocked (external):** SMS provider credentials and templates; OSRM hosting; verified G‘uzor boundary data; legal review (aggregator obligations, driver eligibility, tax-agent duties, data localisation); real-device testing; final tariffs.

## 6. Known limitations

1. **Routing.** Development uses straight-line × 1.35 estimates (labelled "taxminiy" in the UI). Production requires OSRM or an explicit override.
2. **Service zone.** The G‘uzor polygon is a geometric placeholder around the Wikipedia centre coordinate (38.62083 N, 66.24806 E). It is not a real boundary.
3. **PWA background GPS.** Browsers suspend it when the screen is off. Drivers must keep the app open (documented in [realtime-and-gps.md](architecture/realtime-and-gps.md)).
4. **Unverified adapters.** Eskiz SMS, the Telegram Gateway login-code sender (tested against a mocked API) and S3/R2 storage are written but untested against the real services. The map tile host (OpenFreeMap) is free, as-is, with no SLA.
5. **Fares.** Upfront pricing only: no waiting-time, toll or route-change adjustments, and no cancellation fees.
6. **Contact privacy.** Counterpart phone numbers are visible during an active ride (no proxy calling).
7. **Single region.** The database supports all cities; only G‘uzor has data. Other cities stay inactive until configured (enforced).
8. **Migrations.** Prisma's native engines could not be downloaded here (network policy), so the project uses the Prisma JS/WASM engine through the `pg` driver adapter and its own migration runner. Both are compatible with standard Prisma tooling where its binaries are available.
9. **Brief inconsistency.** The budget is 1,000,000 so‘m in §1 but 10,000,000 so‘m in §18. Both cases are covered in the [cost estimate](deployment/README.md#5-estimated-monthly-cost-pilot).

## 7. Next milestone (recommended)

1. Lawyer consultation on the blockers in pilot-readiness §A, and choose the hosting location.
2. Staging deploy (one VPS): OSRM, Eskiz test account, verified G‘uzor polygon, real tariffs.
3. Real-device test week with 5 drivers and about 20 invited passengers. Fix what it finds.
4. Then: Click/Payme, a native Android driver app (background GPS + push), number masking.
