# Loading Gate — QR scanner for the loading area

* **Loading-area phone:** its own link — **https://abc-loading-gate.sultanachi-lb-61f.workers.dev** (worker `abc-loading-gate`, folder `gate-worker/`).
  No hub account, no other hub tool reachable from it. The phone is paired once by a manager.
* **In the hub:** Day to Day Operations → Loading Gate (`/tools/gate`) — the same scanner for Managers / Supervisors / Security,
  plus **Loading-area phones** (managers only) to pair and remove phones.

## Separate link — how it is protected
* The gate app serves only the scanner page and 5 calls (`pair`, `me`, `lookup`, `decide`, `day`). Everything else returns 404.
* It reaches the hub only through a Cloudflare **service binding** (`HUB` → `operations-hub`) with the shared secret **GATE_KEY**;
  the hub's door `/api/gate-ext/*` refuses any request without that secret.
* **Pairing:** a manager taps *Pair a phone* → an 8-character code + QR, valid 30 minutes, one use. The phone scans the QR (or types the code)
  and receives its own token; the hub stores only its SHA-256. 8 wrong codes from one address → locked 15 minutes.
* **Remove** a phone in the hub → it is cut off at once and shows the pairing screen again.
* Each day the agent writes his name; decisions are saved as "<name> · <phone name>". The phone can only see and act on its own flagship.
* Strict security headers (no framing, camera only, no referrer, CSP).

## Set-up (once)
1. Merge to `main` — the GitHub Action deploys the hub, then the Loading Gate app (`sh gate-worker/build.sh` copies the scanner into it).
2. Make one long random secret (40+ characters, e.g. from a password manager) and add it as **GATE_KEY** (type *Secret*) on **both** workers:
   Cloudflare → Workers & Pages → `operations-hub` → Settings → Variables and Secrets, and the same on `abc-loading-gate`.
3. Hub → Loading Gate → **Loading-area phones** → *Pair a phone* → scan the QR with the loading-area phone → *Add to Home Screen*.

## How the agent uses it
1. Open **Loading Gate** on the phone. The camera starts straight away and the screen stays on.
2. The contractor shows the Tenant Connect QR code; the agent scans it (or taps **Type request number**).
3. The hub asks Salesforce live and shows the request's status in a coloured banner:
   * **Approved** and inside the Valid From / Valid To window → green
   * **REJECTED** (or declined / cancelled) → red
   * Approved but outside its time window, or still pending → amber
   with REQ number, contractor / supplier, tenant, sender, work, From / To.
4. Set the number of workers and press:
   * **APPROVED · IN** (green, دخول مسموح) — one tap for an approved request. The contractor is checked in on Contractors.
   * **REJECTED · OUT** (red, رفض الدخول) — one tap for a rejected request.
   * **Letting in a rejected / not-approved / out-of-time request needs a reason** (duty manager approval, operations by phone, permit extension, emergency works, other). It is saved as an *override* and the flagship is notified.
   * Refusing an approved request also needs a reason.
   * **Leaving** appears when the contractor is already on site — it checks them out.
5. A full-screen ✓ / ✕ confirms, and the scanner is ready for the next pass.

**Salesforce not connected yet, or no signal:** the banner says **Check the pass**, with a button that opens the pass in Salesforce.
When the agent presses a button he first answers **What does the pass show? Approved / Rejected** — nothing to type.

**Which handover line?** The line is found by its REQ number. The hub gets it from Salesforce (connector), or straight from the QR when
the pass QR carries it: in Salesforce, add `&req=` + the request name to the URL inside the QR formula, e.g.
`…/ABCQRCode/s/?recordId={!Id}&req={!Name}` → `…?recordId=a0G…&req=REQ-008936`. Once a QR has been matched, the hub remembers it.
Decisions taken without signal are kept on the phone ("Not sent yet") and sent automatically when the connection is back.

## Shift Handover
* The day's handover line of the same REQ (the Portal Handover line imported from Tenant Connect) gets the outcome added at its end:
  * `— ✓ Attended 23:58 · 3 workers` (approved in; `· override: <reason>` when let in against Salesforce)
  * `— ✕ Refused at gate 08:40 · Permit expired` (rejected out)
  * `… → left 02:10` (checked out)
  A newer decision replaces the older mark. Typed lines are matched too, by the `REQ-…` written in them.
  The open handover page picks up new marks every minute (and when the page comes back to the screen), and saving from a page opened earlier never removes them.
  When the REQ has no line in the day's handover, nothing is added there — it is still in the table below.
* The live tracker also has a **Loading area gate** table (time, contractor, tenant, REQ, approved in / rejected + reason, overrides), and the same table goes into the handover email.

## How the request is read
The QR holds the Tenant Connect pass link (`https://abclebanon.my.site.com/ABCQRCode/s/?recordId=a0G…`). On every scan the hub
reads that pass **the same way the pass page does**: it starts the public screen flow **QRCodeFlow** with the `recordId` and takes what
the page shows — Request Name (REQ), Contractor / Supplier, Sender, Account (tenant), Maintenance Type, Sub Maintenance, Notes,
Valid From / To, and **IsApproved** (the APPROVED / REJECTED stamp). No set-up, no login.
* Only QR links on `abclebanon.my.site.com` are read (more hosts: variable `PASS_HOSTS`, comma-separated; flow name: `PASS_FLOW`).
* If the flow's screen labels change (e.g. "Request Name"), update `passMap` in modules/gate.js.
* If the pass cannot be read (Salesforce down, no signal), the agent opens the pass and taps what the stamp shows.
* The optional Salesforce Connected App below is only a backup; it is not needed.
* Managers see a **fields read** panel under each result. Once a QR is matched to a request, the hub remembers it.

## Salesforce settings (optional, recommended)
Salesforce Setup → App Manager → New Connected App ("ABC Operations Hub — Loading Gate"):
* Enable OAuth · callback `https://login.salesforce.com/services/oauth2/success` · scope **Manage user data via APIs (api)**
* Tick **Enable Client Credentials Flow**; after saving: Manage → Edit Policies → **Run As** = an integration user who can read the QR / request object.
Cloudflare → Workers → operations-hub → Settings → Variables and Secrets:
| Name | Type | Value |
|---|---|---|
| `SF_DOMAIN` | Text | `abclebanon.my.salesforce.com` (your My Domain) |
| `SF_CLIENT_ID` | Secret | Consumer Key |
| `SF_CLIENT_SECRET` | Secret | Consumer Secret |
| `SF_FIELDS` | Text (optional) | pin field names if the automatic match is wrong, e.g. `{"status":"Stamp__c","tenant":"Account__r","from":"Valid_From__c","to":"Valid_To__c","contractor":"Contractor_Company_Name__c","sender":"Sender_Name__c"}` |

Fields are matched automatically by name: REQ number (any `REQ-…` value), Account / Tenant, Contractor / Supplier, Sender, Valid From/To (or Date From/To), Status (or the stamp), Notes and Description.
The **Run As** user must be able to read the request object and those fields (Field-Level Security).

## Technical
* `modules/gate.js` — routes `ops/gate/lookup`, `ops/gate/decide`, `ops/gate/day`; table `gate_scans`; column `sf_id` added to `contractor_visits`.
* Check-in/out write the same `contractor_checks` rows as the Contractors tool. Decisions with the same `clientId` are saved once (offline replays).
* Permit window: valid from 30 minutes before the start (`EARLY_MIN`) to the end time. Rejection reasons: `GATE_REASONS`.
* `gate-worker/` — worker.js (proxy + headers), wrangler.jsonc (service binding HUB), public/common.js (pairing, agent name, offline queue), sw.js, manifest; `public/index.html`, `tools.css`, `jsqr.min.js`, icons are copied from the hub by `build.sh`.
* Table `gate_devices` (name, token hash, pairing code hash + expiry, last seen, agent on duty, removed).
* `tools/gate.html` — camera via BarcodeDetector (Android Chrome) or `tools/jsqr.min.js` (jsQR 1.4.0, Apache-2.0) on iPhone.
* Handover: `handover/live` returns `gate`; `tools/handover.html` draws it and adds it to the email. The line marks are written by `gateMarkHandover` and kept on save by `keepGateMarks` (worker.js).
* `tools/common.js` — `gate/decide` added to the offline queue. `sw.js` caches the scanner (cache v18).

## Offline booking list (Oct 2026)
The gate phone keeps today's and tomorrow's contractor bookings (`GET /api/ops/gate/offline`), refreshed every 10 minutes while online.
A scan without signal shows the booking found on the phone (or warns that it is not in the list); the decision is queued as before.

## On the Day to Day timeline (Oct 2026)
`/api/ops/today` returns the day's gate counts and every refused scan. The timeline shows a red ✕ at the time of each refusal
(refusals within 20 minutes share one mark; the popup lists contractor, REQ, time, agent and reason with "Open Loading Gate"),
and the Contractor Access card adds "gate N in · M refused".

## Quick Access Pass (October 2026)
The gate also reads **Quick Passes** (`…/qp/<token>` or typed `QP-ABCDEF`): valid for 30 minutes from approval, one entry. See FEATURE-quick-pass.md.
