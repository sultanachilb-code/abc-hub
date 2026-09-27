# Feature record — Reminders

Added: September 2026 · Status: live · Owner: Sultan Al Achi

## What it does
- **Reminders** tile in the *Operations Tools* cascade.
- The flagship Manager / Senior Mall Supervisor (and Admins) pick the reminders each flagship needs:
  time of the first reminder, optional repeat ("every 10 min until 13:00"), and the days it runs.
  A **Recommended** list adds a ready set in one tap (restroom windows 1–6, handovers, MOM, PIR, site visits, opening/closing rounds).
- Every 2 minutes (the existing cron) the hub checks each reminder that is due:
  - **done** → nothing is sent, and the repeats stop for the day;
  - **pending** → a bell entry and a push to **everyone at that flagship** — no link to the Schedule,
    so on shift or off makes no difference. Repeats are marked "Still pending (n)" and sent as urgent;
  - **couldn't check** (a system did not answer) → nothing is sent; it shows on the page and in History.
- Admins without a flagship receive every flagship's reminders (same as other hub alerts).
- Push reaches only devices where the person turned notifications on (Settings → Notifications).

## What each type checks
| Type | Done when | Answer comes from |
|---|---|---|
| Restroom inspections | every restroom has a log for the window (Operations, Soft services, or both) | Restroom system `/api/hubday` |
| Shift handover | the Morning/Evening handover is submitted (or received by the next shift) | hub `handovers` table |
| Overdue MOM tasks | no published task at the flagship is past its deadline | hub `mom_actions` |
| Post-incident reports | no Level 2/3 report is overdue (or waiting at all) | Incident system `/api/hubday` |
| Site visit points | no site visit has open points longer than N days | Snaglist `hubsv=1` |
| Custom task | someone at the flagship taps **Mark done** in Reminders | hub `reminder_done` |

## Everything it adds (to remove the feature, undo exactly these)
| Where | What |
|---|---|
| `modules/reminders.js` | **New file.** Tables, checks, cron run, routes. |
| `tools/reminders.html` | **New file.** The Reminders page. |
| `docs/FEATURE-reminders.md` | **New file.** This record. |
| `worker.js` | 5 lines marked `Reminders feature`: the `import`, `await remindersSchema(env)`, `remindersRun(...)` in `scheduled()`, the `reminders:` permission in `rights()`, and the `reminders/` route in `opsRoute`. Plus `reminders: "Reminder"` in the push names list inside `pushRun`. |
| `apps.js` | The `reminders` tile (marked with a comment). |
| `index.html` | The `alarm` icon in the icon list (harmless to keep). |

### Database tables (D1 `hub-db`)
- `reminders` — one row per reminder: flagship, type, name, time, repeat, days, settings, on/off.
- `reminder_runs` — every check (day, time slot, result, pushed yes/no). Kept 90 days.
- `reminder_done` — custom tasks marked done (who, when), one per reminder per day.
```sql
DROP TABLE reminder_runs; DROP TABLE reminder_done; DROP TABLE reminders;
DELETE FROM hub_events WHERE app = 'reminders';
```
