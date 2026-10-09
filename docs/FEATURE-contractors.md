# Contractors

**Operations Tools → Contractors** (`/tools/contractors`) — Managers, Supervisors, Security.

* **On site** (today, or any day): every approved Tenant Connect request is a contractor visit — company, tenant, work, REQ number, permit time.
  * Filled automatically when the **shift handover imports the Handover Report** (approved requests only), or with *Import requests* here, or *+ Add* by hand.
  * **Check in** (number of workers, note) and **Check out** — by the operations team and security. Undo if pressed by mistake.
  * Counters: expected, on site (with workers), not arrived, left, **over permit time**.
  * Still checked in **30 minutes after the permit ends** → one alert to the flagship.
* **Register**: every company (added automatically from the import, or by hand): trade, contact, mobile, email, **insurance expiry** (reminders 30 and 7 days before and on the day), Active / Blocked. A blocked contractor asks for confirmation at check-in.
* **History**: check-ins by date range, search, or one company's visits.

Files: `modules/contractors.js` · `tools/contractors.html` · `tools/portal-requests.js` (shared Excel reader) · tables `contractors`, `contractor_visits`, `contractor_checks` · cron `contractorsRun`.

## October 2026 — everything reaches the Shift Handover
- A visit added by hand can carry its **Tenant Connect request (REQ)**. Checking it in here writes "✓ Attended 09:12 · 3 workers" on the handover line of the same REQ, like the loading gate does.
- The Shift Handover lists **Contractor access not in this handover** (gate scans, check-ins made here, Quick Passes) with **+ Add to handover**, so a request approved at 4 PM after a morning handover is never lost.
- Importing the tenant requests into the handover looks up the day's contractor access and adds the loading area feedback at once (any day, not only today).
- The "contractor still on site" reminder is switched off (contractor access is information only).
