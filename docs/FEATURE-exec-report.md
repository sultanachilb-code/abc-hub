# Feature record — Executive Report

Added: September 2026 · Status: live · Owner: Sultan Al Achi

## What it does
- **Executive Report** tile under *Property Overview & Info* (Managers, Senior Mall Supervisor, Admins).
  Same design as the hand-made ABC Executive Report; one report per flagship per month (month picker in the top bar).
- **Automatic** (recalculated every time it opens):
  - Occupancy per floor, current and expected, vacant units vs GLA — from the hub **GLA** as it stood on the last day of the month
    (a GLA change with an earlier effective date updates past months too). Status mapping: Open/Closed → Active, Fit-out/Reserved → Fit out.
  - Vacant unit names "Ex-<brand>" — from the GLA change history (can be overridden per unit).
  - Opened / closed year to date — from the GLA change history (1 Jan → end of month).
  - Fit-out tenants and contract date — from the GLA (Fit-out / Reserved + contract start); expected opening typed once per unit.
  - CAPEX projects and annual budget — from **Budget · CAPEX** of that year; deadline, status and comment typed. Status "Hidden" keeps a line out.
- **Manual, saved per month** (Edit data, saves automatically): highlights, commentary, footfall & sales tables (paste from Excel),
  decline import, QC results, extra openings / closings / contracts not in the GLA.
- A month with nothing saved starts from the previous month: QC current → previous, commentary cleared, tables kept (a new year starts with empty sales tables).
- Verdun Mall August 2026 is pre-loaded with the figures of the hand-made report (`data/exec-seed.js`).
- **Export PDF** (this flagship) and **PDF – all malls** (Admins).
- Sales are not automated yet — kept manual until a sales import exists.

## Everything it adds (to remove the feature, undo exactly these)
| Where | What |
|---|---|
| `modules/exec.js` | **New file.** Automatic figures, monthly storage, routes. |
| `tools/exec.html` | **New file.** The report (built from ABC_Executive_Report.html). |
| `data/exec-seed.js` | **New file.** Verdun August 2026 starting figures. |
| `docs/FEATURE-exec-report.md` | **New file.** This record. |
| `worker.js` | 4 lines marked `Executive Report`: the `import`, `await execSchema(env)`, the `exec:` permission in `rights()`, and the `exec/` route in `opsRoute`. |
| `apps.js` | The `exec` tile (marked with a comment). |

### Database table (D1 `hub-db`)
- `exec_reports` — the typed part of each report (flagship, month, data, who, when).
```sql
DROP TABLE exec_reports;
```


## Sales — local only (30 Sep 2026)
Sales are never stored in the hub. **Import sales** reads the monthly *Leasing Sales Performance YTD* workbook in the browser
(tools/exec-sales.js) and fills, for every flagship at once: monthly sales % in the footfall table, total and LFL %, the groups table
(property LFL, DS, Azadea / Aishti / Pearl Brands / Retail Group — editable list, saved as names only), the 14 top contributors to the decline,
new tenants, low performers, plus sales vs last year / budget / 2018, sales by category and cinema / parking.
Everything can be edited, then Export PDF. Closing or refreshing the page removes the sales. The server strips every sales field on save and on read,
and a one-time clean-up erased sales saved before (meta `exec:salesPurged`). Footfall stays saved as before.
Workbook layout expected: sheet "Sales Data Conso" (one row per lease, months by year, LFL flags, space), "Sales Total Summary" (Period YTD), "Footfall Table" (cinema, parking).

## Opening / closing YTD — remove a name (Oct 2026)
In Edit data → Leasing, the **Opening / closing YTD** panel lists every opened and closed name: the ones from the GLA history plus the rows added by hand. Press **✕ Remove** to take a name out of the report (for example a deleted unit) and **↺ Restore** to bring it back. The choice is saved with the report (`hideMoves`), carries into the following months, and resets in January.
