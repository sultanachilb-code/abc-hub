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
