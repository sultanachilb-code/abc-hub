# Portal Dashboard v2 (Oct 2026)

The Portal Dashboard (Dashboards → Portal Dashboard) now reads seven ABC Connect (Salesforce) reports and shows them in tabs.

| Tab | Report | What it shows |
|---|---|---|
| Overview | all | Waiting on tenants, violations resolved %, marketing to review, permits live now, portal users active (or breaches open for supervisors); table by flagship (resolved % in green ≥ 90, amber 75–89, red < 75); new items per month (6 months); the full waiting list |
| Violations | Violations & Requests (VR-) | Waiting list, status, by type, repeat tenants |
| Breaches & Penalties | Breaches & Penalties (BP-) | Waiting list, status, penalties in the descriptions, repeat tenants |
| ABC Requests | Normal Requests (NR-) | Waiting list, status, repeat tenants |
| Marketing | Marketing Requests (MKT-) | To review (oldest first), approved live or starting in 14 days, approval rate, by type, to review by flagship; tenant and ABC comments |
| Contractor Permits | Contractor Permits (CP-) | Live now, valid today, starting in 7 days, waiting approval, per month, work permit share; tap a mobile number to call |
| Portal Users | Active Users report | Last-login groups (7 / 30 / 90 days, older, never), list with search, top titles. **Managers and leadership only** (MM, OM, Advisor, Director, CDSO, Admin) |

## Report handling
- Salesforce ".xls" exports (really HTML, ISO-8859-1) are read as they are, accents kept (Café), emoji statuses cleaned ("Approved ??" → Approved).
- **Resolved / Unresolved Violations** is a part of Violations & Requests: it only updates the items it has and never marks the others as left ("details only").
- **Flagship:** the Branch column; else the account name ("SOCKS Achrafieh DS L1" → Achrafieh DS); else the GLA when the brand is at one flagship only. Lines that still can't be placed are listed in the import message.
- **Contractor Permits** have no Branch / Account column: they are kept for all flagships (every flagship sees them) until IT adds the columns.
- **Portal Users** have no Account / Branch column: one list for the portal. When IT adds them, the hub reads them.
- Unchanged rows are skipped on re-import (fingerprint), so a daily subscription writes only what changed.

## Brief by role
- Manager: tile **Portal items waiting** (sent to tenant; red with 10+ over 30 days) + follow-ups for items over 30 days and marketing in review over 7 days.
- Advisor / Director / CDSO KPI rows: **Portal violations resolved (older than 7 days)** and **Marketing requests answered (older than 7 days)**. The newest week is left out (an item sent yesterday can't be answered yet), so Today / 7 days show "—".
- Both can be switched off in ⚙ Brief settings.

## Getting the reports in
- Email the 7 reports to `abcoperationshub+portal-<TAG>@gmail.com` (Salesforce subscription), or **Import reports** on the page (several files at once).
- **Gmail script change (once):** in `hub-inbox.gs` replace `sheets.slice(0, kind === 'portal' ? 6 : 3)` with `sheets.slice(0, kind === 'portal' ? 10 : 3)`. Until then, send the reports in two emails (6 + 1).

## For IT (to ask)
1. Contractor Permits: add **Branch** and **Account**.
2. Active Users: add **Account Name** and **Branch**.
3. Violations & Requests: add **Description** (then the Resolved/Unresolved report is not needed).
4. All reports: add **Record ID** (Open in portal goes straight to the record); Marketing Requests: fill **Branch** on every line.
