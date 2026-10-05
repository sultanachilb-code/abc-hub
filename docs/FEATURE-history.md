# Change history

**Hub administration → Change history** — who changed what, when, before → after. Kept **12 months**.

Recorded:
* Field by field (before → after): GLA, People & roles, Operations Calendar, Evacuation plan, Contractors register, Projects.
* One line per action (with the values sent): Tenants Directory, Budget uploads and uses, Property details, Shift handover (submit, receive, delete, line from Outlook), Reminders, MOM, Tenant feedback, Mall layouts, Tenant announcements, Fit-out, Checklist templates, Tenant Works Forms, handover shifts.
* Executive Report: only that it was edited — **figures are never recorded**. Passwords are never recorded.

Filters: tool, flagship, person, text, date range. `GET /api/ops/history?tool=&ref=` gives one record's history to anyone with that flagship.

Files: `modules/history.js` (`makeAudit`, `historyList`, `historyClean`) · table `change_log` · the `auditOps` map in `worker.js`.
