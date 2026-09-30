ABC Operations Hub — Tenants Directory + Profile (30 Sep 2026) — separate package
Built on top of the handover fixes and the home folders (both already inside these files).

Install: copy everything (except the revert folder) into the abc-hub folder, replacing files, then deploy.
  worker.js · apps.js · index.html
  modules/directory.js (new) · modules/profile.js (new) · modules/automation.js
  tools/directory.html (new) · docs/FEATURE-directory.md · docs/FEATURE-profile.md
No database steps — the new tables are created on the first request.

After deploying
1. Hub → Tenant Management folder → Tenants Directory → "Reception link" → Create → copy it to reception.
   Do this once per flagship (switch flagship at the top). Treat the link like a password.
2. Reception types straight into the table (no pop-ups) — each row saves by itself; the last row adds a new contact.
   Or import your Excel (Import Excel button) — headers:
   Tenant Name | Employee Name | Position | Mobile N. | Email | Category | Location | Status | LandLine
3. Admin → Flagship covers → upload one wide picture per flagship.

To go back: copy the files in revert/ into the abc-hub folder (replacing), then deploy.
The new files (directory.js, profile.js, directory.html) can stay — nothing uses them after reverting.
