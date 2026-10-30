# Restroom inspection: each flagship's own timing, and emails through Outlook (Oct 2026)

## Own timing
- The KPI brief's "Restroom inspection compliance" reads each flagship's windows and restroom list from the Restroom Inspection system (`/api/hubconfig`). The list is kept 10 minutes in memory and saved in `meta rr:cfg`.
  - Dbayeh has its own six 30-minute windows: 11:00–11:30, 13:00–13:30, 15:00–15:30, 17:00–17:30, 19:00–19:30 and 21:00–21:30.
  - The other flagships keep the standard windows.
- **Expected** = the restrooms in the Restroom system (6 for Dbayeh) × the windows already closed.
- **Grace is unchanged:**
  - the standard flagships count from 11:00, 13:30, 15:30, 17:30, 19:30 and 21:30;
  - a flagship with its own windows counts each window from when it closes.
- Hovering a value shows its basis, for example "15 of 18 inspections · 6 restrooms × 3 windows closed so far".
- The Restroom system's own summaries also use Dbayeh's windows:
  - `/api/hubstats`: tile badge, compliance and missed;
  - `/api/hubnotify`: end-of-day summary;
  - `/api/hubday`: End of Day grid and morning email.
- Reminders use Dbayeh's windows too.
- **Fallback:** if the Restroom system cannot be reached, the brief uses the standard windows and the rooms inspected in the last 30 days.

## Emails through Outlook
- The Restroom system writes every email (window reminder, 23:00 daily report, issue alert) into `email_outbox` in abc-restroom-db.
- The hub's cron (`modules/rrmail.js`, every 2 minutes) sends them through the hub's Outlook connection, from salaachi@abc.com.lb when it is connected, otherwise from the hub's default Outlook sender.
- There is no Google Apps Script fallback.
- If Outlook is not connected, emails wait and are retried for about 30 minutes, then marked failed. The administrators get one alert a day.
