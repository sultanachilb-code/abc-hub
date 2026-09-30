ABC Operations Hub — Executive Report: sales local only (30 Sep 2026) — separate package
Install: copy modules/, tools/, data/, docs/ into the abc-hub folder (replace), then deploy.
  modules/exec.js · tools/exec.html · tools/exec-sales.js (new) · data/exec-seed.js · docs/FEATURE-exec-report.md

How to use each month
1. Open Executive Report → Import sales → choose "Leasing Sales Performance YTD <year>.xlsx".
2. All five flagships fill in at once (switch the tabs). Change anything you want in Edit data → Footfall & Sales.
3. Export PDF (or PDF – all malls).
4. Close the page: the sales are gone. Nothing was sent to the hub.
Footfall (the two footfall columns) is still saved in the hub as before.

On the first request after deploying, the hub erases the sales that were saved in past months (one time).
To go back: copy the files in revert/ over the abc-hub folder and deploy (the erased sales do not come back).
