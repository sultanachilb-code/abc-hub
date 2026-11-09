# Performance Dashboard (Nov 2026)

One tile (**Dashboards → Performance Dashboard**, `/tools/perf`) replaces the tiles of the leadership Performance Dashboard, Monthly Operations Pack, Executive Report, Snaglist Report and Data Accuracy Score (those apps stay, `hidden: true`, and open from its menu, alerts and search).

- Look: **light frost glass** with light purple borders (`--edge:#C9B2E6`), purple accent.
- **Named menu on the left** (top row on phones), no tabs: Overview · Flagship status · Soft services · Monthly Pack · Leadership Pack · Executive Report · Snaglist Report · Data updated. Each page opens beside the menu (iframe, "Open full screen ↗"); the leadership page takes `?tab=ov|sc|pk&embed=1` and hides its own tabs.
- **Overview**: welcome + alert chip (flagships with "action required"), flagship picker · average occupancy (vacant units, fit-out, active tenants) · restroom checks done last 14 days · needs attention (all flagships) · one occupancy ring per flagship with its light and **Open ›** (flagship status, or the pack) · an icon per page with live figures (snaglist open / added / solved from `/api/ops/snag/report`) · "Data last updated" line (GLA, property details, executive report, budget — oldest flagship).
- Data: `/api/ops/perf/summary` → pages this user may open (same access as each old tile) + `siteOverview` per flagship (modules/leadership.js).
- Access: MM, OM, SMS, LEAD (and admins); each menu item follows the old tile's access — e.g. a Senior Mall Supervisor sees Overview and Snaglist Report.
- Both packs are kept for now (Monthly Pack = pack.html, Leadership Pack = the leadership A4 pack) — to be merged later.

## v2 (8 Nov 2026)
- **Full width** (no centred column) over **layers**: the Verdun Mall aerial photo (`/tools/induction/cover_VRM.jpg`) brightened and blurred · a frosted white veil · three soft colour glows — the glass cards are see-through on top.
- **Executive Report** is back as its own tile (Reports) — not in this menu.
- **Restroom Inspections** (redesign, native page — the old "Restroom Inspection Dashboard" tile, a link to the separate system, is hidden; "Open the inspection system ↗" opens it):
  - cards: done so far (of the checks due by now · whole day), missed (OPS vs Soft services, worst restroom this week), issues reported (most frequent problems), this month vs last month + average minutes after the window opens;
  - grid: restroom × time window, each cell OPS | Soft services (done / in progress / missed / upcoming, gold ring = issue), current window outlined;
  - all flagships today (tap to switch), most missed restrooms last 7 days, done last 30 days, issues reported with problems, comments, who and when; any past day with the date picker; refreshes every 2 minutes.
  - Data: `/api/ops/perf/restroom` — the day's grid from the restroom system (`/api/hubday`), the inspections from `RR_DB.inspection_logs` (issues, delay), `daily_stats` (30 days, month vs last month), the last 7 days' grids (most missed).
- Overview: "Restroom inspections today" ring (all flagships shown) and restroom % on each flagship ring.

## v3 · white (Nov 2026)
Rebuilt in the clean white admin look (Modernize style) with ABC purple, light and dark (the hub's own setting; 🌙/☀️ in the top bar switches it everywhere).
- **Left menu with names:**
  - Performance: Overview · Flagship status · Restroom Inspections · Soft services
  - Reports: Monthly Pack · Leadership Pack · Snaglist Report · **Report builder**
  - Data: Data updated
- **Overview:**
  - Six tiles: Incidents this month (+ late PIRs) · Open snags · Restroom score (month) · Malfunctions open · AM/PM checklists % · Footfall this month (parking entries).
  - Footfall chart: per day, this month vs last month, with entries per day and ▲/▼.
  - Snaglist donut: open / added / solved this month.
  - Restroom wave: 14-day trend, ▲/▼ vs last week.
  - Incidents and malfunctions-fixed cards (▲/▼ vs last month, average days to fix).
  - Tenant compliance hero card (falls back to Occupancy).
  - Needs attention list.
  - Flagship status table (click a row to focus that flagship).
  - Data-updated footer.
- **Data:** `ops/perf/summary` now also returns per flagship `restroomMonth`, `incidentsMonth`, `pirsOverdue`, `repeatOffenders`, `violations`, plus `perfExtra()`: malfunctions open / fixed this and last month / average days, and footfall (`ff_days.entries`) this and last month with the daily series.
- **One look:** `tools/dash.css` (tokens `--d-*`, light and dark) is loaded by Leadership (status, soft services, pack), Monthly Pack, Snaglist Report, Report builder and Data updated.
- **Executive Report:** stays its own tile, in the same purple look on screen. Dark mode is screen only; print and PDF stay white.
