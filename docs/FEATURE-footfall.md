# Footfall (Nov 2026)

Car footfall per flagship, inside the hub. Replaces the old Footfall Hub worker (`footfall-hub`, switched off 2 Nov 2026 — workers.dev disabled, nothing deleted).

Files: `modules/footfall.js` · `tools/footfall.html` (hub object) · `tools/ffentry.html` (Liban Park form, `/ff/<token>`).

## 1. Daily import
- Flagships: Verdun Mall, Achrafieh Mall (ON), Dbayeh (OFF) — switched in **Settings**.
- 09:00 (Beirut): one email per flagship to Liban Park (To / CC in Settings) with a link for **yesterday**. No hub account; the link works for that flagship and day, 10 days.
- Reminders every hour 10:00 → 14:00 while not sent. At 15:00 a missing day raises a hub notification to the operations team (`ff-ops`).
- On the 1st, the same email also asks for last month's **parking duration** (15 min … 12 hours).
- Form: per gate Tickets · Cards · Employees (or Users / Passes), free tickets; totals worked out on the page; a large entries/exits gap asks to double-check.
- The operations team can open any day, enter or correct it (a reason is required for a correction), copy or resend the link.

## 2. Monthly report
- Merges the days; each flagship carries a badge **"1 Nov – 15 Nov 2026 · 15 of 30 days"**, missing days listed.
- Entries, without employees, daily average (per flagship, missing days do not pull it down), busiest day, vs last month, day-by-day chart, gates, exits & free tickets, year by month, day table.

## 3. Analysis
- Weekday averages, parking duration distribution, employee share. More is added on request.

## Settings (operations team)
- Flagship ON/OFF, Liban Park To / CC, gate list per flagship (name, entry/exit, kind).
- **Revenue** ON/OFF (managers / admin): OFF = Membership and Total balance are not asked for and not kept (switching off clears them).

## Access
- View: operations team + Directors / Advisor / CDSO (their flagships). Edit and settings: Admin, flagship managers, operations team (not Warehouse).

## History import
- Liban Park daily workbook (one sheet per month): gate columns → the chosen flagship; "ABC Achrafieh — Total Entries" columns → day totals for that flagship. Zero days are skipped (missing).
- Parking duration workbook (one sheet per year).
- Dates are read at noon so the Beirut clock change (e.g. 29 Mar) never shifts a day.

## Data
`ff_days (site, day)` · `ff_dur (site, month)` · `ff_req` (links) · `ff_log` · `meta ff:cfg`.
