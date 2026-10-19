# Brief by role (Oct 2026)

The home-page brief now depends on the user's title.

| Title | Brief |
|---|---|
| Operations team (supervisors, officers, warehouse…) | No brief panel (its figures still feed the tile badges) |
| Mall / Operations Manager (MANAGER) | **Action brief** for his flagship: tiles + "Your follow-ups" |
| Property Advisor (ADVISOR) | **KPI brief**, every flagship, month to date by default |
| Mall Director | **KPI brief**, Verdun Mall and Achrafieh Mall only |
| CDSO | **KPI brief**, Achrafieh DS, Verdun DS and Dbayeh DS only |
| Admin | "Preview as" Manager / Advisor / Director / CDSO + **⚙ Brief settings** |

## Manager tiles
Incidents · PIR, AM/PM checklists, shift handover, malfunctions, snaglist, restroom inspection, tenant feedback,
marketing events, cleaning, contractors, contracts ending. Red/amber tiles also become follow-ups. Every tile opens its system.

## KPI rows
Restroom inspection compliance, incident PIR on time, AM checklist on time (11:00), PM checklist on time (22:45),
handover on time, cleaning compliance, malfunctions fixed within 48 h, snags solved, GLA occupancy (by area),
contractor entries, contracts ending (next 60 days).

* Colours: green ≥ 90 %, amber 75–89 %, red < 75 %. ▲▼ = change against the previous period of the same length.
* Periods: Today · 7 days · Month (month to date, default). "—" = the system is not used / no data at that flagship.
* "Weakest this period" lists the three lowest percentages. Figures are cached 10 minutes.

## Settings
Admin → ⚙ Brief settings: a checkbox matrix (item × title), stored in `meta` key `brief:cfg`. Default: everything on.

## API
`GET /api/brief/role?as=&site=&period=today|7d|month` · `GET|POST /api/brief/settings` (admin). Code: `modules/rolebrief.js`.
Incidents and restroom figures come from the read-only D1 bindings (INC_DB, RR_DB); snaglist via its API connector.
