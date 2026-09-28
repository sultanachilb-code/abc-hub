# Data Accuracy Score

Property Overview & Info → **Data Accuracy Score** (`/tools/accuracy`, route `/api/ops/accuracy`, module `modules/accuracy.js`).

For each flagship it shows the last update date and time (and who made it) for:

| Item | Where the date comes from | Up to date | Update due | Out of date |
|---|---|---|---|---|
| GLA & Occupancy | last unit change or GLA event | ≤ 30 days | ≤ 60 days | older |
| Property Details | last value changed | ≤ 90 days | ≤ 180 days | older |
| Executive Report | last month saved | last month saved | 1 month behind | older |
| Budget CAPEX & OPEX | this year's sheets uploaded | both | one of the two | none this year |

Points: up to date 100 · due 60 · out of date 20 · never updated 0. The flagship score is the average of the four.
People who can reach several flagships (Property Advisor, Mall Directors, CDSO, Admin) also see a comparison table.

Remove: delete `modules/accuracy.js`, `tools/accuracy.html`, the `accuracy` tile in `apps.js` and the two lines marked "Data Accuracy Score feature" in `worker.js`.
