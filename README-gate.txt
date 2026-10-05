ABC Operations Hub — Loading Gate (QR scanner) — 5 Oct 2026
Install: copy these files into the abc-hub folder (replace), then upload to GitHub — the hub deploys itself.
  NEW      modules/gate.js · tools/gate.html · tools/jsqr.min.js · docs/FEATURE-gate.md
  CHANGED  worker.js · apps.js · sw.js · tools/common.js · tools/handover.html
Nothing else changes. No new database to create — the table is made on the first request.

Loading-area phone: sign in to the hub with the Security (or Supervisor) account → Day to Day Operations → Loading Gate
→ allow the camera → "Add to Home Screen" so it opens like an app.

Optional (live Salesforce check of status and permit times): see docs/FEATURE-gate.md → "Salesforce settings".
Without it, the gate works from the approved requests the handover imports; each new QR is linked once by tapping its request.
