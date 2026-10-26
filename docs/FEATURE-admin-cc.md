# Admin Control Center (Oct 2026)

`/admin` (`tools/admin.html`, `modules/admincc.js`) — administrators only. The admin signs in on the normal login page with his own account,
then opens it from the account menu → **Admin Control Center** (Hub administration stays for announcements, people & roles, covers…).

| Section | What it does |
|---|---|
| Overview | Red / amber alerts + today's cards: users online, emails, D1, requests, R2, ABCON, systems, jobs, backup, security |
| Users & access | Everyone with position, flagships, two-step ways, last activity (online = active in the last 10 min), lock. **View as** (read-only, 30 min, logged), temporary password, reset two-step, sign out of every device, unlock, switch on/off |
| Security & sign-ins | 30-day sign-in log (OK, wrong password, unknown email, locked), locked accounts, admin actions, **Sign everyone out** |
| Allowances & usage | Outlook queue + automatic sender + secret expiry, Gmail relay left today, D1 reads / writes / size (7 days), Worker requests (all workers, today), R2 storage + operations, ABCON neurons (7 days) |
| Systems & jobs | Connected systems answering (Snaglist, Incidents, Restroom, Cleaning, Footfall, Gate, relay, Microsoft, Salesforce, AI), scheduled jobs with last run + Run now / Send me a test, settings & secrets (names only) |
| Tools control | Per tool: on / off, folder (or a new folder), who sees it (MM, OM, SMS, MS, MO, WH, SEC, LEAD), usage in 7 days, ↺ default. Saved in `meta tools:cfg`; applied in `/me` (tiles) and `roleAllows` (server); people see it at their next refresh (60 s cache) |
| Data & backup | Download a full backup, last automatic backup, rows per table, clean-up (notifications > 90 d, usage log > 1 y, sign-in log > 90 d, sent Outlook emails > 90 d) |
| Announcements & more | Links to the Hub administration tabs |

## Security added
- **Lock**: 5 wrong passwords in a row → locked 15 minutes (admins notified); the admin can unlock.
- **Sign out everywhere**: sessions now carry their issue time; `users.signout_at` cancels older ones.
- **View as**: signed cookie `hub_viewas` (admin + target, 30 min). While on, every POST and SSO is refused ("read-only"), a purple bar shows *Back to my admin* (`/api/viewas-stop`).
- Sign-in log `admin_signins` (kept 180 days).

## Alerts
Hourly (07:00–22:00) health check; each red problem is pushed to the administrators once a day. Heartbeat `cron:beat` shows whether the 2-minute scheduler runs.
