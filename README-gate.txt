ABC Operations Hub — Loading Gate (QR scanner) — 5 Oct 2026
Install: copy these files into the abc-hub folder (replace), then upload to GitHub — the hub deploys itself.
  NEW      modules/gate.js · tools/gate.html · tools/jsqr.min.js · docs/FEATURE-gate.md
  CHANGED  worker.js · apps.js · sw.js · tools/common.js · tools/handover.html
Nothing else changes. No new database to create — the table is made on the first request.

Loading-area phone: sign in to the hub with the Security (or Supervisor) account → Day to Day Operations → Loading Gate
→ allow the camera → "Add to Home Screen" so it opens like an app.

Salesforce connector (needed for the live APPROVED / REJECTED status): docs/FEATURE-gate.md → "Salesforce settings".
Until it is set, the agent opens the pass and taps what the stamp shows (Approved / Rejected).
Rule at the gate: approving a REJECTED (or not valid) request always asks for a reason and notifies the flagship.
