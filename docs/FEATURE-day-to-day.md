# Day to Day Operations — live timeline

A home-screen section that sits above Leadership. It replaces the tiles of four tools: Operations Schedule, Minutes of Meeting, Shift Handover and Contractors.

## What it shows (one flagship, today, refreshed every minute)
- **Timeline 06:00 → 24:00** with a gold "NOW" line. It starts earlier if something begins before 06:00, and it scrolls sideways on phones.
  - **Team on shift**: one bar per shift time, with first names. The shift on now is outlined, shifts that have ended fade, and last night's shift shows striped.
  - **Contractors**: one bar per permit.
    - Expected: dashed outline.
    - On site: solid.
    - Left: faded.
    - Over permit time: red, and the bar runs to now.
  - **Meetings & events**: MOM meetings and ops activities from the calendar that have a start time.
  - **Handover pins** (gold) at each hand-off time. The latest one pulses while it waits to be received.
  - **Restroom windows** use the window times from the Restroom system, with the rooms done by Operations (for example "W2 · 2/3"). Green means all rooms are done, amber means the window is open now, red means rooms were missed, and a dashed outline means the window is still to come. Only Manager and Supervisor roles see them.
  - **Deadlines** are shown as pills that end at the due time:
    - AM Checklist: by 11:00.
    - AM Handover: by 15:00 (a hand-over between 11:00 and 18:00).
    - PM Checklist: by 22:45.
    - PM Handover: by 22:50 (a hand-over after 18:00).
    - The pill colours: green ✓ shows the time it was done, amber means done late or due within the hour, red ⚠ means overdue, and purple means upcoming.
  - **Handed-over line**: each time someone presses Submit on the Shift Handover, a gold dashed vertical line runs down the whole timeline from that time. Its label reads "Handed over 13:30 · Mazen → Mohamad".
  - All-day items (a marketing event, a MOM with no time) and staff who are off show as chips above the timeline.
- **Tap any bar or pin** to see details and a button that opens the tool.
- **Four cards** under the timeline, each with a live line and a status pill:
  - Schedule: on duty now, next person in.
  - MOM: next meeting, open and overdue actions.
  - Handover: waiting or received.
  - Contractors: on site, expected, over time.
- Users with more than one flagship get a flagship picker. Each device remembers the choice.

## Rules
- Each card and lane follows the app's visibility. For example, Contractors appears only for Manager, Supervisor and Security roles; Advisor/Director/CDSO/Admin see all apps anyway.
- Search still lists the four tools as normal tiles. The header tools menu still includes them, first in the list.

## Changing the deadlines
Edit `DEADLINES` at the top of `modules/today.js`.

## Technical
- `GET /api/ops/today?site=XX` is served by `modules/today.js`. It is read-only.
- It reads `form_runs` (AM/PM), the Restroom system's day (cached for 2 minutes per flagship), `sched_cells` (today and yesterday), `handovers`, `mom_meetings`/`mom_actions`, `cal_items` and the contractors day list (`dayList`, now exported from `modules/contractors.js`).
- `apps.js` adds the new group "Day to Day Operations" first in `GROUPS`, and moves the four apps into it.
- `index.html`: `d2dHtml()` and `loadToday()`. The phone layout fix gives the main column `minmax(0,1fr)`.
