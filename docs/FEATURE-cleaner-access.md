# Cleaner Access — the Cleaner QR system inside the hub (Oct 2026)

Before: `abcv-admin-access` (admin page) + `abcv-loading-area-access` (badge page with agent PIN) on Cloudflare, Google Apps Script backend,
sheet "ABC Verdun - Cleaner Control Sheet" (Workers, Attendance, Agents, Images, VerificationLog). Copy of all of it: private repo
`abc-restroom-inspection`, branch `cleaner-qr-source`.

## In the hub
- Tile **Cleaner Access** (`tools/cleaners.html`, id `cleaner-qr`): Today · Cleaners · Attendance · Tenants · Daily report · Migration (admin).
- Each flagship sees only its own cleaners. **Head of Security** (Security role, position `HOS`, People & roles) sees every flagship, like Admin/Advisor; Directors/CDSO their flagships.
- Register / edit / Suspend / Blacklist / new QR: operations team, flagship managers, Head of Security, Admin. Security staff: view.
- Blacklist: no entry anywhere; same name or phone cannot be registered again at any flagship.
- Photos and ID copies in R2 `cleaners/<id>/photo.jpg|idcopy.jpg`. Badges printed from the hub (QR → `https://operations-hub…/cp?id=…&t=…`).

## Scanning
- **Loading Gate app** (gate account of the flagship + the guard's name): full pass with ID copy and **Check in** (once per day).
  Another flagship's cleaner: photo + name + "No access at <flagship> — registered at <flagship>", nothing recorded.
  Routes: gate-ext `cleaner`, `cleaner-in` (gate-worker allow-list), inside the hub `ops/gate/cleaner(-in)`.
- **Any other phone camera**: `/cp` information card (photo, name, status, tenant, company, flagship) — no buttons, no ID copy.
- Old badges keep working: `cleaner-forward/` redeploys `abcv-loading-area-access` and `abcv-admin-access`; they serve the old pages
  while `meta cl:mode = sheet` and forward to the hub (`/cp`, Cleaner Access) once `hub` (checked every 30 s through the HUB binding).

## Emails (Outlook, from salaachi@abc.com.lb)
- 21:00 daily entry report per flagship — To: security supervisor (Daily report tab), Cc: the flagship's operations group email (+ extra Cc).
- Last day of each month 10:00 — one verification email per tenant (tenant email from the Tenants tab), Cc the operations group email.
- Only once switched; afterwards delete the Apps Script triggers `sendDailyReport` and `sendMonthlyVerification`.

## Migration (Cleaner Access → Migration, administrators)
0. Apps Script: add `apiHubExport_` + the `hubExport` lines in `doGet`, deploy a **new version** (code shown in the tab). Uses the existing HUB_KEY property / CLEANER_SHEET_KEY.
1. Copy cleaners (with tokens and tenant emails) · 2. photos and ID copies (3 per call) · 3. check-ins (a week per call, idempotent) · 4. verification log
5. Compare per flagship · 6. Switch (`cl:mode = hub`); the last week of check-ins is copied again before and 90 s after. Switch back any time — the sheet is untouched.
