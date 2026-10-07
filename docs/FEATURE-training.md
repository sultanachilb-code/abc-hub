# Training Tracker (Oct 2026)
Tile in Policies & Procedures → `/tools/training`.
- Courses are shared by all flagships: name, category, validity in months (0 = no expiry) and the positions that must have it
  (MM, OM, SMS, MS, MO, WH, SEC). Seeded: Health & Safety induction, Fire warden (12 mo), First aid (24 mo), Evacuation drill (12 mo),
  ABC Connect portal, Customer service. Management and Senior Mall Supervisors edit the courses.
- People: the hub users of the flagship, plus people outside the hub (security guards, cleaners…) added by name with the position they count as.
- Matrix person × course: done (green), expires within a month (amber), expired (red), required but not done (dashed red).
  One "Training done" entry can record a whole group trained the same day; the expiry comes from the course validity unless typed.
- KPIs: % of required training done, required-not-done, expired, expiring within a month. Expiring / expired items go into the weekly digest.
- Tables `tr_courses`, `tr_people`, `tr_records`; routes `/api/ops/tr/*` (`modules/training.js`).
