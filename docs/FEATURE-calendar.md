# Operations Calendar

One monthly calendar per flagship — **Operations Tools → Operations Calendar** (`/tools/calendar`).

| Kind | What | Who adds |
|---|---|---|
| Marketing event | Dates, times, location, status (Planned / Confirmed / Cancelled), organiser, set-up, dismantle, **plan** (tasks with owner, due date, done) | Operations team |
| Ops activity | Fire drill, PPM, deep cleaning, night works… — can repeat weekly / monthly / yearly | Operations team |
| MOM meeting | Read automatically from Minutes of Meeting (nothing typed twice) | — |
| Objective | Pinned at the top of a month, tick when achieved | Operations team |
| Expiry date | Insurance papers, licences, certificates, contracts. Reminders to the flagship **30, 7 and 1 day before and on the day**. Tick “Renewed” to stop them | Operations team |

* Operations team = Managers, Supervisors, Senior Mall Supervisor and administrators of that flagship. Everyone else reads.
* Marketing events of a day also appear in that day's **shift handover** (Marketing events table, marked “📅 calendar”) and in the handover email.
* Month view (Mon → Sun), list view, filters per kind, print. On a phone the grid shows dots; tap a day for its list.
* Changes are kept in **Change history**.

Files: `modules/calendar.js` · `tools/calendar.html` · table `cal_items` · cron: `calendarRun` (expiry reminders).
Remove: delete the files, the `calendar` lines in `worker.js` (import, schema, route, cron) and the tile in `apps.js`.
