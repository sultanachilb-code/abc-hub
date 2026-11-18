# Data explorer (Nov 2026)

Admin Control → 🔎 **Data explorer** — administrators only (Admin Control unlocked). `modules/dbx.js`, page section `dx` in `tools/admin.html`.

- **Systems**: Hub (`DB`), Restroom (`RR_DB`), Incidents (`INC_DB`) are read directly. Snaglist and ABC Audit are on other Cloudflare accounts: each has `POST /hubquery` (`hubquery.js` in its repo), signed with HMAC-SHA256 — Snaglist with `HUB_KEY`, ABC Audit with `HUB_QC_KEY` (= `AUDIT_KEY` in the hub); requests older than 2 minutes are refused.
- **Read-only**: one statement, starting with SELECT or WITH; any keyword that could change data is refused (checked on both sides).
- **Hidden columns**: passwords / hashes / salts, two-step secrets and backup codes, tokens, session ids, pairing codes, push keys (`SECRET_COL`).
- **Limits**: 5,000 rows on screen, 50,000 in an Excel / CSV export.
- **Saved queries**: `dbx_saved`, shared by all administrators.
- Every run is written to the change history (tool `admin`, ref `data-explorer`).
- No query across two systems (separate databases).
