# Loading Gate — QR scanner for the loading area

**Day to Day Operations → Loading Gate** (`/tools/gate`) — Managers, Supervisors, Security. Built for the loading-area phone.

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
When the agent presses a button he first answers **What does the pass show? Approved / Rejected** — the same reason rule then applies.
Decisions taken without signal are kept on the phone ("Not sent yet") and sent automatically when the connection is back.

## Shift Handover
The handover's live tracker gets a **Loading area gate** table (time, contractor, tenant, REQ, approved in / rejected + reason, overrides) and the same table goes into the handover email.

## How the request is read
The QR holds a Salesforce link (`…/ABCQRCode/s/?recordId=a0G…`). On every scan the hub reads that record from Salesforce
(status, REQ, contractor, tenant, sender, dates). The status is taken from the status field or from the APPROVED / REJECTED
stamp image (its alt text / file name). Managers and admins see a **Salesforce fields read** panel under the result,
to check what the gate reads — use it with `SF_FIELDS` below if a field is picked wrongly.
If the request is also on the hub's approved list (imported by the handover), the scan is linked to it for Contractors and the Day to Day timeline.

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
* `tools/gate.html` — camera via BarcodeDetector (Android Chrome) or `tools/jsqr.min.js` (jsQR 1.4.0, Apache-2.0) on iPhone.
* Handover: `handover/live` returns `gate`; `tools/handover.html` draws it and adds it to the email.
* `tools/common.js` — `gate/decide` added to the offline queue. `sw.js` caches the scanner (cache v18).
