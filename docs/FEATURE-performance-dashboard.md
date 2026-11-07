# Performance Dashboard (Nov 2026)

One tile (**Dashboards → Performance Dashboard**, `/tools/perf`) replaces the tiles of the leadership Performance Dashboard, Monthly Operations Pack, Executive Report, Snaglist Report and Data Accuracy Score (those apps stay, `hidden: true`, and open from its menu, alerts and search).

- Look: **light frost glass** with light purple borders (`--edge:#C9B2E6`), purple accent.
- **Named menu on the left** (top row on phones), no tabs: Overview · Flagship status · Soft services · Monthly Pack · Leadership Pack · Executive Report · Snaglist Report · Data updated. Each page opens beside the menu (iframe, "Open full screen ↗"); the leadership page takes `?tab=ov|sc|pk&embed=1` and hides its own tabs.
- **Overview**: welcome + alert chip (flagships with "action required"), flagship picker · average occupancy (vacant units, fit-out, active tenants) · restroom checks done last 14 days · needs attention (all flagships) · one occupancy ring per flagship with its light and **Open ›** (flagship status, or the pack) · an icon per page with live figures (snaglist open / added / solved from `/api/ops/snag/report`) · "Data last updated" line (GLA, property details, executive report, budget — oldest flagship).
- Data: `/api/ops/perf/summary` → pages this user may open (same access as each old tile) + `siteOverview` per flagship (modules/leadership.js).
- Access: MM, OM, SMS, LEAD (and admins); each menu item follows the old tile's access — e.g. a Senior Mall Supervisor sees Overview and Snaglist Report.
- Both packs are kept for now (Monthly Pack = pack.html, Leadership Pack = the leadership A4 pack) — to be merged later.
