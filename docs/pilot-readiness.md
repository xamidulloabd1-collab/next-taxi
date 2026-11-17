# G‘uzor pilot — operational readiness checklist & commercial launch blockers

The software MVP passes its technical acceptance workflow (see [PROGRESS.md](PROGRESS.md)). **Being technically complete is not the same as being ready to launch commercially.** Everything below must be done by people, outside the code.

## A. Commercial launch blockers (must be resolved before taking real rides)

| # | Blocker | Why | Owner / next step |
|---|---|---|---|
| 1 | **Legal entity & aggregator status** | Operating a taxi-ordering platform requires a registered business and compliance with transport rules (e.g. Cabinet of Ministers Resolution No. 200 of 2 April 2025 on passenger road transport). | Lawyer: confirm the obligations that apply to a taxi aggregator in Qashqadaryo. |
| 2 | **Driver eligibility rules** | Reporting on that resolution says drivers need a taxi licence, operate only in the territory on their licence, and (since 2025) on-demand taxi drivers must be Uzbek citizens. The app now asks for a taxi-licence document; the review procedure must check licence territory, validity and the self-employed registration. | Compliance reviewer: written verification procedure; lawyer to confirm the list. |
| 3 | **Tax-agent duties** | From 1 January 2026 self-employed taxi drivers pay a 1% turnover tax, and aggregators have withholding/reporting duties for income earned through their platform. The cash model means the platform never holds the fare. | Accountant/lawyer: define what the platform must report or withhold, then implement it. |
| 4 | **Personal-data compliance & hosting location** | Article 27¹ (amended March 2026) still requires domestic storage of biometric data; other data has conditions for foreign processing. Driver photos/selfies may qualify. | Lawyer: classify the data and pick the hosting location. Possibly register as a personal-data operator. |
| 5 | **Verified G‘uzor service boundary** | The seeded zone is a 3.5 km geometric placeholder around the Wikipedia city-centre coordinate, not a surveyed boundary. | City manager: draw or paste a verified boundary (OSM/official data) in Admin. |
| 6 | **Login-code delivery** | Telegram Gateway (`OTP_CHANNEL=telegram`) and Eskiz SMS adapters are written but untested against the live services. Passengers without Telegram need the SMS fallback. | Create a Gateway account and top up the balance; for SMS, sign the Eskiz contract and get approved templates. Test logins on real phones. |
| 7 | **Road routing** | Dev mode uses straight-line estimates (flagged "taxminiy" in the UI). Production refuses this unless `ALLOW_ESTIMATED_ROUTING=true`. | Deploy OSRM with the Uzbekistan extract; spot-check 20 local routes. |
| 8 | **Final tariffs** | Seed tariffs are configurable examples, not market prices. | Business decision; publish via Admin → Tariflar. |
| 9 | **Terms, privacy policy, driver agreement** | `/legal/*` pages are drafts marked as such. | Lawyer-approved Uzbek (and Russian) texts. |
| 10 | **Real-device testing** | Automated tests ran in headless Chrome only. | Test on 3–4 low-end Android phones on Beeline/Ucell/Mobiuz/Uzmobile (3G and 4G), plus one iPhone. See section C. |

## B. Operational readiness

- [ ] On-call phone number for passengers and drivers (Admin → Sozlamalar → `support_phone`)
- [ ] Support hours defined; operator trained on the admin console (live rides, cancel/complete interventions, SOS handling)
- [ ] SOS procedure: operator calls the reporter within N minutes; escalates to 112/102 when needed; resolution recorded
- [ ] Driver onboarding day: document checks in person, vehicle inspection, app training (keep the app open; GPS; cash confirmation)
- [ ] Commission collection procedure: where and when drivers pay; receipts; finance records each payment the same day
- [ ] Debt limit (`maxDriverDebt`) agreed and communicated to drivers
- [ ] Lost-and-found and complaint handling scripts (Uzbek/Russian)
- [ ] Daily review: open incidents, open tickets, reconciliation report, NO_DRIVER rate, cancellations
- [ ] Backups verified with a restore drill; uptime monitoring alerting a phone
- [ ] Launch with a limited driver group (5–15) and invited passengers before a public launch

## C. Real-device test plan (not yet executed)

| Scenario | Pass criterion |
|---|---|
| Install PWA (Android Chrome "Add to Home screen") | Opens standalone; icon and name correct |
| OTP SMS on each mobile operator | Delivered within 30 s |
| Passenger GPS indoors/outdoors | Pickup defaults to current location within ~50 m outdoors |
| Driver app 60 min online, screen on | GPS sent continuously; battery drain measured and recorded |
| Driver locks the screen | Behaviour documented (expected: updates stop; driver goes offline after 10 min) |
| Weak 3G / airplane-mode toggle mid-ride | App reconnects; state correct after reconnect; no duplicate bookings |
| Offer countdown + vibration | Visible, audible/vibrates, accept works within the window |
| Full ride on real streets of G‘uzor | Route sensible; fare equals quote; history and earnings correct |
| Low-end device performance | Booking screen interactive within ~5 s on 3G; no jank when the map pans |

## D. Known product gaps (acceptable for the pilot, plan them)

- Cash only. Click/Payme need contracts and an integration ([architecture §6](architecture/overview.md#6-money-model-srcfeaturespayments)).
- No push notifications; the driver must keep the app open. A native Android driver app is the robust fix.
- No number masking (proxy calls); real phone numbers are shown to counterparts during active rides.
- No scheduled rides, promo codes, surge pricing, multi-stop trips or in-app chat.
- Cancellation fees are not charged.
- The interface is Uzbek-only; the architecture is i18n-ready, but Russian and English copy is not yet written.
