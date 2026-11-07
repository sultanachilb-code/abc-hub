# Memo (Nov 2026, Upcoming - Testing)

Tile **Memo** (Hub Applications, `/tools/memo`) — official memos from the operations team to tenants.

- Memo = subject, category, text, one attachment (PDF / image / Word / Excel, 8 MB, R2 `memo/…`), numbered per flagship `VRM-2026-001` (meta `memo:seq:<prefix>`; `ABC-…` when several flagships).
- Tenants must **Acknowledge** (one button + name) or **Reply** (text + optional file + name). The answer can be changed while the memo is open.
- Audience (`audience` in `modules/memo.js`): open GLA tenants of the chosen flagships, filtered by category (from the GLA sub-category, `catOf`), sub-category, mall level, CRM handheld (`crm_rows`), Direct Banking (`dbank_machines`), then ticked one by one. One email per shop, with its own link, to the Tenants Directory contacts (by position) + the Tenant Portal Database at the levels ticked (default Shop, Brand, Company, Group). Emails editable before sending.
- **Send me a test** sends the email to the author first.
- Reminders: automatic every N days up to M times (default 2 × 3, per memo, can be off) from 09:00 (`memoRun`, meta `memo:run`), until the answer-by date; **Remind waiting** / 🔔 per tenant at any time.
- Board: % answered per flagship, Acknowledged / Replied / Waiting / Not opened / No email, replies and their files, edit emails or record an answer given in person, copy the tenant link, export, close / re-open.
- Tables: `memo_memos`, `memo_targets`. Routes: `/api/ops/memo/*` (send: operations team) · tenant page `/memo/<token>` → `tools/memotenant.html`, API `/api/memo-ext/<token>[/file|/rfile|/answer]`.
