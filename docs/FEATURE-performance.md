# Operations Performance Hub

Added: November 2026 · Status: initial · Owner: Sultan Al Achi

## What it does
New unified dashboard with a **vertical sidebar** that brings together the most important operational views into one place:

- Overview (KPIs + Soft Services + Accuracy + Flagship status)
- Today
- Soft Services
- Accuracy
- Snaglist
- End of Day
- Monthly Pack
- Footfall

Light theme with dark purple accents, matching the rest of the hub.

## Files added / changed
| File | Change |
|------|--------|
| `modules/performance.js` | **New.** Aggregates accuracy, leadership scorecards and overview. |
| `tools/performance.html` | **New.** Vertical menu + Overview page. |
| `apps.js` | New tile under Dashboards. |
| `worker.js` | Import + route. |
| `docs/FEATURE-performance.md` | This file. |

Routes: `/api/ops/performance/overview` and `/api/ops/performance/accuracy`

Visible to Mall Managers, Operations Managers, Leadership and Admins (same flagship scoping as the rest of the hub).
