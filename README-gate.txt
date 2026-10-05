ABC Operations Hub — Loading Gate (QR scanner) — 5 Oct 2026
Install: copy these files into the abc-hub folder (replace), then upload to GitHub — the hub deploys itself.
  NEW      modules/gate.js · tools/gate.html · tools/jsqr.min.js · docs/FEATURE-gate.md
           gate-worker/ (worker.js · wrangler.jsonc · build.sh · .gitignore · public/common.js · public/sw.js · public/manifest.webmanifest)
  CHANGED  worker.js · apps.js · sw.js · tools/common.js · tools/handover.html · .assetsignore · .github/workflows/deploy.yml
Nothing else changes. No new database to create — the table is made on the first request.

Loading-area phone (own link, no hub account): https://abc-loading-gate.sultanachi-lb-61f.workers.dev
  1. Add the secret GATE_KEY (same long random value) to BOTH workers: operations-hub and abc-loading-gate.
  2. Hub → Loading Gate → Loading-area phones → Pair a phone → scan the QR with the loading phone → Add to Home Screen.
  The agent writes his name each day. Remove the phone in the hub to cut it off at once.

Salesforce connector (needed for the live APPROVED / REJECTED status): docs/FEATURE-gate.md → "Salesforce settings".
Until it is set, the agent opens the pass and taps what the stamp shows (Approved / Rejected).
Rule at the gate: approving a REJECTED (or not valid) request always asks for a reason and notifies the flagship.
