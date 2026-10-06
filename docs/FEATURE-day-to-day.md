# Day to Day Operations — live timeline

A home-screen section that sits above Leadership. It replaces the tiles of four tools: Operations Schedule, Minutes of Meeting, Shift Handover and Contractors.

## What it shows (one flagship, today, refreshed every minute)
- **Timeline 06:00 → 24:00** with a gold "NOW" line. It starts earlier if something begins before 06:00, and it scrolls sideways on phones.
  - **Team on shift**: one bar per shift time, with first names. The shift on now is outlined, shifts that have ended fade, and last night's shift shows striped.
  - **Contractors**: a dot at the time each permit ends, labelled "Tenant - Contractor" (for example "Fashmore - Cool Tech").
    - Several permits ending at the same time share one dot showing the count ("2 contractors"). Tap it to list them all.
    - Dot colours: filled amber = on site, hollow = expected, grey = left, red = over permit time.
  - **Tenant closing**: a 🏁 flag ending at mall closing (22:00), for example "Sport Expert · final operating day 22:00". It comes from a closure or relocation announcement in Tenant Announcements with today's date, or a departure date of today in the Contracts Near Ending report.
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
- The Contractors card is now **Live contractor access** (with a green live dot). Tapping it shows the contractors in the mall right now: tenant, company, work, time in, permit end and workers, with a button to open Contractors.
- **Four cards** under the timeline, each with a live line and a status pill:
  - Schedule: on duty now, next person in.
  - MOM: next meeting, open and overdue actions.
  - Handover: waiting or received.
  - Contractors: on site, expected, over time.
- Users with more than one flagship get a flagship picker. Each device remembers the choice.

## Rules
- **Who sees what on the home screen:**
  - Admin sees both the brief and the timeline.
  - Management and leadership (Manager, Advisor, Director, CDSO) see the Morning/Afternoon/Evening brief. They don't get the timeline; the four tools show as normal tiles under "Day to Day Operations".
  - Everyone else (the operations team, Warehouse, Security) sees the Day to Day timeline and no brief panel. The brief's figures still drive the live counts on their tiles.
  - The rule is `SENIOR_ROLES` in `index.html`.
- Each card and lane follows the app's visibility. For example, Contractors appears only for Manager, Supervisor and Security roles; Advisor/Director/CDSO/Admin see all apps anyway.
- Search still lists the four tools as normal tiles. The header tools menu still includes them, first in the list.

## Changing the deadlines
Edit `DEADLINES` (and `MALL_CLOSE` for tenant closing) at the top of `modules/today.js`.

## Technical
- `GET /api/ops/today?site=XX` is served by `modules/today.js`. It is read-only.
- It reads `form_runs` (AM/PM), the Restroom system's day (cached for 2 minutes per flagship), `sched_cells` (today and yesterday), `handovers`, `mom_meetings`/`mom_actions`, `cal_items` and the contractors day list (`dayList`, now exported from `modules/contractors.js`).
- `apps.js` adds the new group "Day to Day Operations" first in `GROUPS`, and moves the four apps into it.
- `index.html`: `d2dHtml()` and `loadToday()`. The phone layout fix gives the main column `minmax(0,1fr)`.

## Portal approvals scanned before they reach the handover (Oct 2026)
The loading gate writes its outcome on the handover line with the same REQ. If a request was approved during the day and
scanned at the gate before anyone imported it, there was no line to write on. Now the hub looks up the day's gate scans:
- when the handover page refreshes (every 30 s, and right after a portal import), the marks of every REQ scanned today are applied;
- on every save, the server adds the gate's outcome (✓ Attended · ✕ Refused at gate · → left) to any line whose REQ was scanned that day.
The Loading area feedback column then shows green / yellow as usual.
