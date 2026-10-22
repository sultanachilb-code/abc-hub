# Supervisor Coverage timeline (Upcoming - Testing, Oct 2026)

Asked for by the Property Advisor: one hour-by-hour timeline per week showing who covers each hour.

- Page: `tools/coverage.html` · tile `coverage` in **Upcoming - Testing** · API `GET /api/ops/coverage?site=&from=&to=` (read-only).
- Built from the weekly Operations Schedule (`sched_cells`) — nothing new to fill.
- Counts only people whose position is **Senior Mall Supervisor (SMS)** or **Mall Supervisor (MS)** at the flagship.
- Each day runs 07:00 → 01:00. An hour is covered when a shift covers at least 30 minutes of it; a shift past midnight covers the 00:00 row of the day it started.
- Colours: **green** SMS / MS on duty (initials) · **yellow** no supervisor, Mon–Fri 08:00–16:00 (Deputy Operations Manager, Operations Manager and Mall Manager in the mall) · **red** not covered.
- Top: % covered, management hours, uncovered hours. Bottom: "Gaps to fill". Print / PDF.

## Testing folder is open to everyone
Everything in **Upcoming - Testing** is seen and usable by every position while it is tested (Sultan, Oct 2026):
`TESTING_OPEN` in worker.js and the testing-group rule in index.html. Only the admin settings pages (Message of the Moment,
Seasonal Decorations) stay admin-only (`TESTING_ADMIN_ONLY` in apps.js). When a tool leaves testing, remove it from
`TESTING_OPEN` and set its ACCESS line.
