# Memo (Nov 2026, Upcoming - Testing)

Tile **Memo** (Hub Applications, `/tools/memo`) — official memos from the operations team to tenants.

- Memo = subject, category, text, one attachment (PDF / image / Word / Excel, 8 MB, R2 `memo/…`), numbered per flagship `VRM-2026-001` (meta `memo:seq:<prefix>`; `ABC-…` when several flagships).
- Tenants must **Acknowledge** (one button + name) or **Reply** (text + optional file + name). The answer can be changed while the memo is open.
- Audience (`audience` in `modules/memo.js`): open GLA tenants of the chosen flagships, filtered by category (from the GLA sub-category, `catOf`), sub-category, mall level, CRM handheld (`crm_rows`), Direct Banking (`dbank_machines`), then ticked one by one. One email per shop, with its own link, to the Tenants Directory contacts (by position) + the Tenant Portal Database at the levels ticked (default Shop, Brand, Company, Group). Emails editable before sending.
- **Send me a test** sends the email to the author first.
- Reminders: automatic every N days up to M times (default 2 × 3, per memo, can be off) from 09:00 (`memoRun`, meta `memo:run`), until the answer-by date; **Remind waiting** / 🔔 per tenant at any time.
- Board: % answered per flagship, Acknowledged / Replied / Waiting / Not opened / No email, replies and their files, edit emails or record an answer given in person, copy the tenant link, export, close / re-open.
- Tables: `memo_memos`, `memo_targets`. Routes: `/api/ops/memo/*` (send: operations team) · tenant page `/memo/<token>` → `tools/memotenant.html`, API `/api/memo-ext/<token>[/file|/rfile|/answer]`.

## Layout (Nov 2026, v2 — like an ABC Connect group)
- Opening page: one group card per flagship (tenants, memos, last memo) — `/api/ops/memo/groups`.
- Group page (`?site=VRM`): header (Broadcast only, ‹ All groups) · **Memo composer** (subject, category, text, attachment, Recipients, Acknowledge / Reply, reminder choice, Send me a test, **Share**) · **feed** of the flagship's memos (sort latest / most waiting, search) with "👍 Acknowledge x / y", replies, views, waiting, 🔔 Remind. Tapping a count opens the tracking list (`?site=VRM&memo=<id>`).
- Recipients: All tenants, or any combination of **Category**, **Sub Category**, **Mall Levels**, **Contract Terms** (CRM · Direct Banking · Both = tenants with CRM and Direct Banking — `filt.contract`). Live count "→ N tenants · M emails", **see / untick tenants** to untick or edit emails.
- Emails are not chosen on the page: Tenants Directory contacts (all positions) + Tenant Portal Database at all levels.

## Email layout (Nov 2026, v3)
Outlook-safe email (tables, inline styles, VML button for Outlook desktop): purple header with the flagship and "MEMO" (+ "REMINDER"), gold line, details box (memo no., date, To = tenant + unit, category, subject), the memo **as written** (`memoBody`: empty line = paragraph, line breaks kept, "-" / "•" / "1." lines = bullets, `**bold**`), attachment card, "Action required … by <date>" strip, button "✓ Read & acknowledge the memo" / "Reply to the memo", footer. "Dear <tenant> team," is added only when the memo doesn't start with a greeting. The hub feed and the tenant page show `**bold**` too.
