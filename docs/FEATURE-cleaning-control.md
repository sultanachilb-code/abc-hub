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
