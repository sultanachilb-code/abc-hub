# Cleaning Headcount control (Oct 2026)
Tile in Inspections → `/tools/cleaning`. The cleaning provider's punching record (PDF from its time-attendance system, e.g. BPM
"WorkingINOUT1" bulletin) is read on the page with pdf.js: employee number, name, and per day IN / OUT / worked, the period and the print time.
- Plan per flagship: provider name, shifts (name, from, to, planned headcount) and a grace in minutes. On the first upload the shifts are
  suggested from the punches (grouped by start time); "Suggest from this record" does it again. Save plan keeps it.
- Checks: headcount per shift and day vs plan (shortages in red), late entries, early exits, missing IN / OUT punches, long shifts
  (more than 1 h over the shift). Shifts of the last day not started when the record was printed are not counted.
- The PDF marks late / early / absence with colours only, which do not come through as text — the hub uses the shift times instead.
- Stored: the plan (`cl_settings`) and the parsed punches per period (`cl_reports`; the same period uploaded again replaces it).
  Routes `/api/ops/cl/*` (`modules/cleaning.js`).

## Contract headcount instead of shifts (7 Oct 2026)
The provider has no fixed shifts: it can work any time but must keep the headcount agreed in the contract. The page now checks
- the **agreed headcount per day** (people who punched in that day; the day the record was printed counts only up to the print time),
- the **minimum on duty at any time** during the cover hours (default 10:00–22:00), counted every 30 minutes and shown as a strip per day,
- missing IN / OUT punches and shifts longer than a set number of hours (default 13).
Late / early checks were removed (no shifts). Figures are typed in the Contract card and recalculated on Save.
