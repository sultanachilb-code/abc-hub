# Snaglist Report (Oct 2026)
Tile in Inspections → `/tools/snagreport` (management, Senior Mall Supervisors, leadership; only the flagships the person can open).
- Data from the Snaglist Manager: `GET <snaglist>/api?hubreport=1&from=&to=` with the HUB_KEY (abc-snaglist PR #1).
- Page: this month / last 7 days / last month / last 30 days or any dates. Totals, a table per flagship (open now, added, solved,
  solved vs added, site visits posted / closed / open / open over 2 days, snaglists started) and per flagship the status mix,
  the oldest open findings and the busiest locations. Print / PDF and Excel.
- Every Monday from 08:00 Beirut the last 7 days are emailed to management and leadership (morning email on), once a week.
Code: `modules/snagreport.js`, route `GET /api/ops/snag/report`.
