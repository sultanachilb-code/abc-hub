# Loading Gate — QR scanner for the loading area

**Day to Day Operations → Loading Gate** (`/tools/gate`) — Managers, Supervisors, Security. Built for the loading-area phone.

## How the agent uses it
1. Open **Loading Gate** on the phone. The camera starts straight away and the screen stays on.
2. Scan the contractor's Tenant Connect QR code (or tap **Type request number**).
3. The hub shows a coloured banner — **Permit valid** (green), **Not started yet** (amber), **Expired / Not approved / Blocked** (red) — with contractor, tenant, REQ number, work, permit From/To and status.
4. Set the number of workers and press:
   * **APPROVED · IN** (green, دخول مسموح) — the contractor is checked in on Contractors and shows "On site" on the Day to Day timeline.
   * **REJECTED · OUT** (red, رفض الدخول) — choose the reason; the flagship gets a notification.
   * **Leaving** appears when the contractor is already on site — it checks them out.
5. A full-screen ✓ / ✕ confirms, and the scanner is ready for the next pass.

Letting someone in when the permit is **not** valid asks for a reason, is saved as an *override* and notifies the flagship.
Without signal the decision is kept on the phone ("Not sent yet") and sent automatically when the connection is back.

## Shift Handover
The handover's live tracker gets a **Loading area gate** table (time, contractor, tenant, REQ, approved in / rejected + reason, overrides) and the same table goes into the handover email.

## How the request is found
The QR holds a Salesforce link (`…/ABCQRCode/s/?recordId=a0G…`). The hub looks for, in order:
1. a contractor visit already linked to that QR;
2. **Salesforce** (live status and permit times) — only when the SF settings below exist;
3. otherwise the agent taps the matching request from today's list **once**; the QR is linked and the next scans find it by themselves.

Today's list is the approved requests imported by the Shift Handover from the Tenant Connect Handover Report (same as Contractors).

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
| `SF_FIELDS` | Text (optional) | pin field names if the automatic match is wrong, e.g. `{"tenant":"Account__r","from":"Valid_From__c","to":"Valid_To__c","contractor":"Contractor__c","status":"Status__c"}` |

Fields are matched automatically by name: REQ number (any `REQ-…` value), Account/Tenant, Contractor, Valid From/To (or Date From/To), Status, Notes and Description.

## Technical
* `modules/gate.js` — routes `ops/gate/lookup`, `ops/gate/decide`, `ops/gate/day`; table `gate_scans`; column `sf_id` added to `contractor_visits`.
* Check-in/out write the same `contractor_checks` rows as the Contractors tool. Decisions with the same `clientId` are saved once (offline replays).
* Permit window: valid from 30 minutes before the start (`EARLY_MIN`) to the end time. Rejection reasons: `GATE_REASONS`.
* `tools/gate.html` — camera via BarcodeDetector (Android Chrome) or `tools/jsqr.min.js` (jsQR 1.4.0, Apache-2.0) on iPhone.
* Handover: `handover/live` returns `gate`; `tools/handover.html` draws it and adds it to the email.
* `tools/common.js` — `gate/decide` added to the offline queue. `sw.js` caches the scanner (cache v18).
