# Weekly digest per person (Oct 2026)
Every Monday from 08:00 Beirut (cron, a few emails per run, once per person per week) each active user gets an email with only their items:
- MOM actions they own that are overdue or due within 7 days;
- malfunctions they logged that are still open after 2 days;
- their training: required-not-done, expired, expiring within a month;
- management and Senior Mall Supervisors: their flagship's portal follow-ups, open high / critical malfunctions, contracts ending within 30 days.
Nobody with nothing to do gets an email. Profile › Weekly digest: On / Off / Preview (`GET /api/ops/digest/preview`, `POST /api/ops/digest/set`).
Column `users.weekly_digest` (default 1). Sent through the mail relay (MAIL_RELAY_URL). Code: `modules/digest.js`.
