# Deployment guide

> Read [../pilot-readiness.md](../pilot-readiness.md) first. Data-localisation rules (Law "On Personal Data", Art. 27¹ as amended in March 2026) may require some data, including driver selfies and ID photos if treated as biometric, to be stored on servers in Uzbekistan. **Confirm hosting location with a lawyer before choosing a provider.**

## 1. Requirements

| Component | Minimum for the G‘uzor pilot |
|---|---|
| App runtime | Node.js 22, long-running process (SSE + dispatch loop). **Not** serverless. |
| Database | PostgreSQL 15+ with PostGIS 3 and pgcrypto (`CREATE EXTENSION` allowed) |
| Server size | 2 vCPU / 4 GB RAM runs app + PostgreSQL + OSRM (Uzbekistan) for a pilot; measure before scaling |
| HTTPS | Mandatory (cookies are `Secure` in production; HSTS header is sent) |
| Storage | Persistent volume for `storage/private`, or a **private** S3-compatible bucket |
| Outbound | SMS provider API, OSRM (local), map tile host |

## 2. Recommended pilot topology (single server, Docker)

```
Caddy (HTTPS, Let's Encrypt) → app:3000 (Next.js + inline dispatch worker)
                              → postgres:5432 (postgis/postgis:16-3.4, volume)
                              → osrm:5000 (Uzbekistan extract)
nightly: pg_dump → off-site object storage;  daily: npm run maintenance:retention
```

### Steps

1. **Server**: Ubuntu 24.04, Docker + Compose, firewall allowing 22/80/443 only. Create a non-root deploy user.
2. **Secrets**: create `.env` from `.env.example`. Set `AUTH_SECRET` (`openssl rand -base64 48`), `CRON_SECRET`, a strong DB password, `APP_URL=https://your-domain`, `TRUST_PROXY=true`, login-code delivery (`OTP_CHANNEL=telegram` + `TELEGRAM_GATEWAY_TOKEN`, and/or `SMS_PROVIDER=eskiz` + credentials), `ROUTING_PROVIDER=osrm` + `OSRM_URL=http://osrm:5000`, `OTP_DEV_ECHO=false`. Leave `APP_ENV` unset (production).
3. **OSRM** (road routing and ETAs). Build once per OSM update:
   ```bash
   mkdir osrm && cd osrm
   wget https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf
   docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/uzbekistan-latest.osm.pbf
   docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/uzbekistan-latest.osrm
   docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/uzbekistan-latest.osrm
   # serve: osrm-routed --algorithm mld /data/uzbekistan-latest.osrm  (port 5000)
   ```
   Extraction RAM grows with the extract size. If 4 GB is not enough, add swap or build on a larger temporary machine and copy the files. Verify routes inside G‘uzor against local knowledge before launch.
4. **Build and start**: `docker compose up -d db`, then build the app image (`docker build -t next-taxi .`) and run it with the `.env`. The container runs `scripts/migrate.ts` before starting.
5. **Seed**: `SEED_ADMIN_PHONE=+998XXXXXXXXX npx tsx prisma/seed.ts` (inside the container). Creates cities, the G‘uzor configuration (**inactive**), example tariffs and the first super admin.
6. **Configure G‘uzor** in Admin → *Shaharlar va hududlar*: replace the placeholder zone with a verified boundary (draw it, or paste GeoJSON exported from OpenStreetMap), set operating hours and dispatch parameters, review tariffs, then activate.
7. **Staff**: Admin → *Sozlamalar* → grant roles (support, finance, compliance).
8. **Scheduled jobs** (host cron):
   ```cron
   15 3 * * *  docker exec next-taxi npx tsx scripts/retention.ts
   30 2 * * *  pg_dump … | gzip | upload-to-offsite-storage
   ```
9. **Monitoring**: external uptime check on `GET /api/v1/health` every minute; `ERROR_WEBHOOK_URL` for error alerts (e.g. a Telegram relay); keep container logs (JSON lines) with rotation.

### Dispatch worker modes

| `DISPATCH_WORKER` | Use when |
|---|---|
| `inline` (default) | Single long-running app process (pilot) |
| `external` | Run `npm run worker` as a separate process/container |
| `off` | Call `POST /api/v1/internal/dispatch/tick` every 2–5 s with `Authorization: Bearer $CRON_SECRET` |

## 3. Managed alternatives

- **Railway / Render / Fly.io** (long-running containers): suitable for the app. Use a PostgreSQL image or service that provides PostGIS, and check that `CREATE EXTENSION postgis` works before committing.
- **Supabase / Neon** (managed PostgreSQL with PostGIS): suitable for the database. Use a pooled connection string only if it supports `LISTEN` — otherwise give the realtime hub a direct connection.
- **Vercel / Netlify**: not recommended. SSE streams and the inline dispatch loop need a persistent process.

## 4. Backups and recovery

- Nightly `pg_dump -Fc` to off-site storage, 30-day retention; also keep a copy before every migration.
- **Restore drill** before launch, and monthly: restore into a scratch database, run `npm run db:migrate` (must report "up to date") and `GET /admin/reconcile` (must report no issues).
- Document storage: back up the volume or enable bucket versioning.
- RPO 24 h / RTO a few hours is realistic for a one-person pilot. Write it down and tell stakeholders.

## 5. Estimated monthly cost (pilot)

**Assumptions:** €1 ≈ 14,500 so‘m and $1 ≈ 12,500 so‘m (verify on the day); about 1,000 OTP logins per month; one server. VPS prices changed several times during 2026, and no public A2P SMS price was found for Eskiz, so every figure below needs a vendor quote.

| Item | Option | Estimate / month |
|---|---|---|
| Server (app + DB + OSRM) | Small 2 vCPU / 4 GB cloud VM abroad (Hetzner-class, about €4–6) | ≈ 60,000–90,000 so‘m |
| — or, if localisation requires it | VPS/colocation in an Uzbek data centre | **get quotes** (likely higher) |
| Login codes — Telegram Gateway (`OTP_CHANNEL=telegram`) | 1,000 × $0.01 per delivered code (Telegram's published price; undelivered codes refunded) | ≈ 125,000 so‘m |
| — or SMS (`OTP_CHANNEL=sms`) | 1,000 × price per SMS (example assumption: 100 so‘m) | ≈ 100,000 so‘m (replace with the Eskiz/Play Mobile quote) |
| Map tiles | OpenFreeMap public instance (free, provided as-is, no SLA) | 0 |
| Off-site backups | Object storage, a few GB | ≈ 15,000 so‘m |
| Monitoring / alerts | Free tiers (uptime check, Telegram webhook) | 0 |
| Domain + TLS | `.uz` domain (annual, prorated) + Let's Encrypt | small; get a registrar quote |
| **Total (abroad hosting)** | | **≈ 175,000–250,000 so‘m** |

What moves the number: SMS volume (each login costs one SMS; longer sessions reduce it), hosting location, OSRM memory needs, and whether the map tile host stays free. Not included: legal advice, licences, company registration, driver acquisition and marketing, test devices, support staff.

**Budget note.** The brief gives two caps: 1,000,000 so‘m (section 1) and 10,000,000 so‘m (section 18). With 1,000,000 so‘m, infrastructure alone runs for roughly 4–5 months, with nothing left for legal work or marketing. 10,000,000 so‘m covers a year of pilot infrastructure plus some legal consultation. Neither guarantees a commercial launch, let alone a nationwide one.
