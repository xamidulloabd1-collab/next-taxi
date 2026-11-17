# Security checklist

Legend: **[x]** implemented and covered by tests · **[~]** implemented but not independently verified · **[ ]** to do before or after launch.

## Authentication & sessions
- [x] Phone OTP: 6 digits, HMAC-SHA256 hashed with `AUTH_SECRET`, 5-minute TTL, single use (`auth.test.ts`)
- [x] Max 5 attempts per challenge, counted atomically (parallel guessing tested)
- [x] OTP rate limits: 3/10 min and 10/day per phone, 20/h per IP; verify 30/h per IP
- [x] Opaque 256-bit session tokens, stored as SHA-256; httpOnly, SameSite=Lax, Secure in production
- [x] Separate session per app (passenger/driver/admin); staff sessions 12 h
- [x] Sessions rejected for blocked/deleted users; revoked on block, role revocation and anonymisation
- [x] Staff OTP is only sent to numbers holding a staff role (no account enumeration in the response)
- [x] `OTP_DEV_ECHO` and the console SMS provider are refused when `APP_ENV=production`
- [ ] SMS-pumping protection beyond rate limits (e.g. CAPTCHA after N requests, allow-listing +998 operators) — monitor SMS spend daily

## Authorisation
- [x] Server-side RBAC matrix enforced in every admin route (`adminRoute`) and admin page (`staffPage`) — e2e: support operator gets 403 on tariffs and settlements
- [x] City scoping for city managers (tested)
- [x] Ride access limited to its passenger/driver (404 for others) — e2e tested
- [x] Realtime events filtered by a server-computed audience; unauthenticated SSE rejected — e2e tested
- [x] Phone numbers visible to the counterpart only during an active ride; masked in admin lists
- [x] Document files: owner driver or `documents.view` only; every staff view is audited

## Input, output, transport
- [x] Zod validation on every body/query; JSON size cap 64 KB
- [x] Prisma parameterised queries; raw SQL uses tagged templates only
- [x] Same-origin check on state-changing requests (CSRF defence in depth)
- [x] Security headers: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS (production)
- [x] Uploads: 6 MB cap, magic-byte type detection (client MIME type ignored), random server-side keys, path-traversal protection, served with `nosniff` and a restrictive CSP
- [~] CSP allows `'unsafe-inline'` scripts (needed for Next.js without nonces) — move to nonce-based CSP later
- [ ] HTTPS everywhere (reverse proxy with TLS) — deployment step
- [ ] Malware scanning of uploaded documents (e.g. ClamAV) — optional

## Data integrity & money
- [x] Fare computed server-side only; client-sent prices ignored (e2e)
- [x] Transactions + row locks + partial unique indexes prevent double assignment, double booking and double accrual (concurrency tests)
- [x] Append-only ledger, ride events, audit logs and settlements (DB triggers); balanced double entry enforced at commit
- [x] Reconciliation report on the finance page
- [x] Idempotency keys on ride creation and settlements

## Operations
- [x] Structured JSON logs with phone/secret redaction
- [x] Error alert webhook (optional)
- [x] Health endpoint for uptime monitoring
- [x] Retention job for OTP/session/idempotency/quote data
- [ ] Secrets in the host's secret manager, rotated on staff changes
- [ ] Database not publicly reachable (private network or firewall); least-privilege DB user for the app (no SUPERUSER)
- [ ] Automated off-site backups + documented restore drill
- [ ] Dependency updates (`npm audit`, Dependabot) and a monthly patch window
- [ ] Independent penetration test before scaling beyond the pilot
- [ ] 2FA / hardware keys for the hosting, DNS, GitHub and SMS-provider accounts
