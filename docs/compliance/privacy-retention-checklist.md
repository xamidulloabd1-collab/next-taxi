# Privacy & data-retention checklist (for review against Uzbekistan law)

**This is an engineering inventory, not legal advice.** It is meant to be reviewed by a lawyer against the Law of the Republic of Uzbekistan "On Personal Data" (ZRU-547, 2019) as amended — including Article 27¹, revised in March 2026 — and against transport and tax regulations.

## 1. Data inventory

| Data | Subjects | Purpose | Where stored | Who can see it |
|---|---|---|---|---|
| Phone number | All users | Login (OTP), contact during an active ride | `users.phone` | Self; ride counterpart only during an active ride; staff (masked in lists) |
| Name | All users | Identification to counterpart | `users.full_name` | Counterpart (passenger sees driver's name; driver sees passenger's first name) |
| Pickup/drop-off coordinates & addresses | Passengers | Fulfil and price the ride, history, disputes | `fare_quotes`, `rides` | Passenger; assigned driver; staff |
| Driver live GPS (latest fix only) | Drivers | Dispatch, passenger tracking | `driver_locations` (one row per driver, overwritten) | Passenger of the active ride; staff (live map) |
| Identity & vehicle documents (licence, passport/ID, vehicle registration, taxi licence, photos, optional selfie) | Drivers | Legal eligibility checks | Private storage + `driver_documents` metadata | Driver; compliance reviewers and super admins (every view audited) |
| Ratings, support messages, safety reports | All | Quality, support, safety | `ratings`, `support_tickets`, `ticket_messages`, `safety_incidents` | Parties concerned; staff |
| Financial records | Drivers | Commission accounting | `payments`, `ledger_entries`, `settlements` | Driver (own); finance staff |
| Session metadata (IP, user agent) | All | Security, fraud prevention | `sessions`, `audit_logs` | Staff (audit) |

## 2. Legal questions to answer before launch

1. **Localisation (Art. 27¹ as amended in 2026).** Reporting on the March 2026 amendment says biometric and genetic data must be stored in Uzbekistan, while other personal data may be processed abroad only under listed conditions (adequate-protection country, or the operator meets listed international standards). Questions: do driver ID photos or selfies count as biometric data? Can the chosen hosting country or provider be used? Is registration in the state personal-data database required?
2. **Legal basis and consent** wording for passengers and drivers; the privacy policy and terms (`/legal/*` are drafts).
3. **Retention periods** below: confirm tax/accounting retention for financial records and ride history.
4. **Data-subject requests**: access, correction and deletion procedure and response times (deletion is implemented via `POST /admin/users/:id/anonymize`).
5. **Sharing with authorities**: procedure for law-enforcement requests; keep a log of disclosures.
6. **Breach response**: who is notified, and how fast.

## 3. Retention (implemented defaults — confirm with counsel)

| Data | Default | Mechanism |
|---|---|---|
| OTP challenges | 30 days | `npm run maintenance:retention` (daily cron) |
| Expired/revoked sessions | 30 days after expiry/revocation | same |
| Idempotency keys | 7 days | same |
| Unused fare quotes | 30 days | same |
| Rate-limit buckets | until window end | same |
| Driver GPS | latest fix only; deleted on account deletion | overwrite + anonymisation |
| Rides, payments, ledger, settlements | kept (accounting) — **period to be set by counsel** | de-identified through account anonymisation |
| Audit logs, ride status events | kept (append-only, integrity evidence) | — |
| Support tickets | 2 years proposed (`RETENTION_DAYS.closedSupportTickets`) — **not yet enforced**, needs a decision | — |
| Driver documents | until account deletion; files deleted on anonymisation | `anonymize` endpoint |

## 4. Account deletion (anonymisation)

`anonymizeUser()` replaces the phone with `deleted:<id>`, clears the name, blocks the account, deletes sessions, GPS and OTP data, cancels pending offers and deletes document files and records. Ride and financial history remains, de-identified. Deletion is refused while the user has an active ride or unpaid commission. Each deletion is audited.

## 5. Minimisation choices already made

- No passenger location tracking; only pickup/drop-off points they choose.
- Only the latest driver position is stored (no breadcrumb history).
- No card data (cash only).
- Staff lists mask phone numbers; full numbers appear only when an operator searches for a specific person.
- The selfie document type is **optional** and can be removed if counsel classifies it as biometric data that cannot be stored on the chosen hosting.
