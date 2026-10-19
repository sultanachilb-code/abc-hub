# D1 reads (Oct 2026)

On 19 Oct 2026 the account passed the free D1 limit (5,000,000 rows read a day; resets 00:00 UTC = 03:00 Beirut).
"Rows read" counts every row a query looks through, for all databases of the account together.

## Measured (GitHub → Actions → "D1 usage report", Cloudflare query insights, last 24 h)
hub-db top queries ≈ 3.4 M · abc-restroom-db ≈ 1.4 M · abc-incidents ≈ 10 k.
| Query | Rows/day | Fix |
|---|---|---|
| Notifications (`hub_events … ORDER BY at`) | > 1.2 M | indexes `hub_events (at)` and `(site, at)` |
| ABCON policy embedding check, every 2 min (2 queries) | ≈ 1.4 M | runs only after an upload / change (`meta pol:dirty`) |
| Restroom rooms count (brief / KPIs) on the Restroom DB | ≈ 0.57 M | counted once a day per flagship (`meta rr:rooms:*`) |
| Patrol settings `meta LIKE 'patrol:cfg:%'` (reads the whole meta table) | ≈ 0.27 M | key range instead of LIKE (also AI cache, KPI cache clean-up) |
| Cleaning tasks per flagship | ≈ 0.19 M | kept 60 s in memory |
| Contractor insurance check, every 2 min | ≈ 0.10 M | once a day |
| Restroom reminder-window move, every 2 min | ≈ 0.08 M | once (`meta mig:rr-windows-oct26`) |
Also: indexes on `sched_cells (site, day)`, `handovers (site, day)`, `mom_actions`, `contractors (ins_expiry)`; KPI brief cache 10 → 30 min.

The Restroom system's own dashboard queries (softservices / inspection group-by, ≈ 0.6 M) are in the abc-restroom-inspection repo.

## Check again
Run "D1 usage report" (period 1d) the next day and compare. If the total stays near the limit, the next steps are a shared
60-second cache for the home checks and slower background jobs; Workers Paid ($5 / month) raises the limit to 25 billion rows a month.
