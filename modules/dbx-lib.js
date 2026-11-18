/* =====================================================================
   DATA EXPLORER — QUERY LIBRARY (Nov 2026)
   Ready-made read-only queries, added to the shared "Saved queries" list
   under the name "Query library". Each name is "Topic · What it shows";
   the Saved queries page groups them by system and topic.
   Raise LIB_VER when queries are added or corrected: the missing ones are
   added and the library's own ones are refreshed (by name); queries saved
   by people are never touched.
   "Today" is Beirut time: date('now','+2 hours').
   ===================================================================== */
export const LIB_VER = 1;
export const LIB_BY = "Query library";

const T = "date('now','+2 hours')";
const SITES = "(VALUES ('VRM'),('VRS'),('ACM'),('ACS'),('DBS'))";
const days = n => `WITH RECURSIVE d(day) AS (SELECT date(${T}, '-${n - 1} days') UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ${T})`;

export const LIBRARY = [
  /* ================= HUB ================= */
  ["hub", "Users · Active users by flagship and position",
   `SELECT site_code AS flagship, role, position, full_name, email, mobile, last_login_at, last_seen_at
FROM users WHERE active = 1 ORDER BY site_code, role, position, full_name`],
  ["hub", "Users · Head count by flagship and position",
   `SELECT COALESCE(site_code, 'All') AS flagship, role, position, COUNT(*) AS people
FROM users WHERE active = 1 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`],
  ["hub", "Users · Never signed in",
   `SELECT site_code AS flagship, position, full_name, email, created_at
FROM users WHERE active = 1 AND (last_login_at IS NULL OR last_login_at = '') ORDER BY site_code, full_name`],
  ["hub", "Users · Not seen for 30+ days",
   `SELECT site_code AS flagship, position, full_name, email, last_seen_at,
  CAST(julianday('now') - julianday(last_seen_at) AS INTEGER) AS days_away
FROM users WHERE active = 1 AND last_seen_at < datetime('now', '-30 days') ORDER BY days_away DESC`],
  ["hub", "Users · Locked or failed sign-ins",
   `SELECT site_code AS flagship, full_name, email, fail_count, locked_until, twofa_fail, twofa_lock
FROM users WHERE COALESCE(fail_count, 0) > 0 OR COALESCE(twofa_fail, 0) > 0 OR locked_until > datetime('now') OR COALESCE(twofa_lock, '') <> ''
ORDER BY fail_count DESC`],
  ["hub", "Users · Two-step sign-in set up",
   `SELECT u.site_code AS flagship, u.full_name, u.email,
  CASE WHEN COALESCE(t.totp_on, 0) = 1 THEN 'Yes' ELSE '' END AS authenticator_app,
  CASE WHEN COALESCE(t.email_on, 0) = 1 THEN 'Yes' ELSE '' END AS email_code,
  (SELECT COUNT(*) FROM user_passkeys p WHERE p.email = u.email) AS passkeys
FROM users u LEFT JOIN user_2fa t ON t.email = u.email WHERE u.active = 1 ORDER BY u.site_code, u.full_name`],
  ["hub", "Usage · Tool opens, last 30 days",
   `SELECT app AS tool, COUNT(*) AS opens, COUNT(DISTINCT email) AS people, MAX(at) AS last_open
FROM usage_log WHERE at >= datetime('now', '-30 days') GROUP BY app ORDER BY opens DESC`],
  ["hub", "Usage · Opens per person, last 30 days",
   `SELECT l.site AS flagship, COALESCE(u.full_name, l.email) AS person, l.role, COUNT(*) AS opens,
  COUNT(DISTINCT l.app) AS tools, COUNT(DISTINCT date(l.at)) AS active_days, MAX(l.at) AS last_open
FROM usage_log l LEFT JOIN users u ON u.email = l.email WHERE l.at >= datetime('now', '-30 days')
GROUP BY l.email ORDER BY opens DESC`],
  ["hub", "Usage · Opens per flagship and tool, last 30 days",
   `SELECT site AS flagship, app AS tool, COUNT(*) AS opens, COUNT(DISTINCT email) AS people
FROM usage_log WHERE at >= datetime('now', '-30 days') GROUP BY site, app ORDER BY site, opens DESC`],
  ["hub", "Usage · Daily active people, last 30 days",
   `SELECT date(at, '+2 hours') AS day, COUNT(DISTINCT email) AS people, COUNT(*) AS opens
FROM usage_log WHERE at >= datetime('now', '-30 days') GROUP BY 1 ORDER BY 1 DESC`],
  ["hub", "Usage · Who never opened a tool (last 30 days)",
   `SELECT u.site_code AS flagship, u.position, u.full_name, u.email
FROM users u WHERE u.active = 1 AND NOT EXISTS (SELECT 1 FROM usage_log l WHERE l.email = u.email AND l.at >= datetime('now', '-30 days'))
ORDER BY u.site_code, u.full_name`],
  ["hub", "Security · Admin Control sign-ins, last 30 days",
   `SELECT at, email, ok, what, ip FROM admin_signins WHERE at >= datetime('now', '-30 days') ORDER BY at DESC`],
  ["hub", "Security · Changes made in the tools, last 7 days",
   `SELECT at, site AS flagship, tool, label, action, by_name, changes
FROM change_log WHERE at >= datetime('now', '-7 days') ORDER BY at DESC`],

  ["hub", "Handover · Submitted per flagship per month",
   `SELECT substr(day, 1, 7) AS month, site AS flagship, shift, COUNT(*) AS submitted
FROM handovers WHERE status = 'submitted' GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3`],
  ["hub", "Handover · Missing days per flagship, last 14 days",
   `${days(14)}, s(site) AS ${SITES}
SELECT s.site AS flagship, d.day FROM s, d
WHERE NOT EXISTS (SELECT 1 FROM handovers h WHERE h.site = s.site AND h.day = d.day AND h.status = 'submitted')
ORDER BY s.site, d.day DESC`],
  ["hub", "Handover · Drafts never submitted",
   `SELECT site AS flagship, day, shift, created_name, created_at, updated_at
FROM handovers WHERE status = 'draft' AND day < ${T} ORDER BY day DESC`],
  ["hub", "Handover · Submitted but not received",
   `SELECT site AS flagship, day, shift, created_name, submitted_at
FROM handovers WHERE status = 'submitted' AND (received_at IS NULL OR received_at = '') ORDER BY day DESC`],

  ["hub", "Checklists · AM / PM submitted per flagship, last 30 days",
   `SELECT site AS flagship, SUM(form = 'am') AS am, SUM(form = 'pm') AS pm, SUM(form = 'open') AS opening, SUM(issues) AS issues_found
FROM form_runs WHERE status = 'submitted' AND day >= date(${T}, '-29 days') GROUP BY site ORDER BY site`],
  ["hub", "Checklists · Missing AM or PM, last 14 days",
   `${days(14)}, s(site) AS ${SITES}, f(form) AS (VALUES ('am'),('pm'))
SELECT s.site AS flagship, d.day, upper(f.form) AS checklist FROM s, d, f
WHERE NOT EXISTS (SELECT 1 FROM form_runs r WHERE r.site = s.site AND r.day = d.day AND r.form = f.form AND r.status = 'submitted')
ORDER BY s.site, d.day DESC, f.form`],
  ["hub", "Checklists · Issues found per run, last 30 days",
   `SELECT day, site AS flagship, upper(form) AS checklist, issues, done, total, submitted_name, submitted_at
FROM form_runs WHERE status = 'submitted' AND day >= date(${T}, '-29 days') ORDER BY day DESC, site`],
  ["hub", "Checklists · Drafts left open",
   `SELECT site AS flagship, upper(form) AS checklist, day, done, total, created_name, updated_at
FROM form_runs WHERE status = 'draft' ORDER BY day DESC`],
  ["hub", "Checklists · Items flagged ⚑ Fix issue",
   `SELECT site AS flagship, upper(form) AS checklist, item_id, note, by_name, at FROM form_fixes ORDER BY at DESC`],
  ["hub", "Checklists · Triggered follow-ups, last 30 days",
   `SELECT at, site AS flagship, upper(form) AS checklist, day, item_text, remark, result, by_name
FROM form_trig_log WHERE at >= datetime('now', '-30 days') ORDER BY at DESC`],

  ["hub", "ABC Connect · Open items by type and status",
   `SELECT CASE kind WHEN 'nr' THEN 'ABC Requests' WHEN 'bp' THEN 'Penalties' WHEN 'vr' THEN 'Violations' WHEN 'mk' THEN 'Marketing Requests' WHEN 'cp' THEN 'Contractor Permits' ELSE kind END AS type,
  status, COUNT(*) AS items, SUM(CAST(julianday(${T}) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) > 7) AS over_7_days
FROM portal_items WHERE active = 1 GROUP BY kind, status ORDER BY kind, items DESC`],
  ["hub", "ABC Connect · KPI pending items per flagship",
   `SELECT site AS flagship,
  SUM(kind = 'nr' AND status = 'Sent to Tenant') AS abc_requests_open,
  SUM(kind = 'bp' AND status = 'In Review') AS penalties_in_review,
  SUM(kind = 'vr' AND status = 'Sent to Tenant') AS violations_open,
  SUM((kind = 'nr' AND status = 'Sent to Tenant') OR (kind = 'bp' AND status = 'In Review') OR (kind = 'vr' AND status = 'Sent to Tenant')) AS total_pending
FROM portal_items WHERE active = 1 GROUP BY site ORDER BY site`],
  ["hub", "ABC Connect · ABC Requests sent to tenant",
   `SELECT site AS flagship, name, tenant, type, subject, created_day, status_since,
  CAST(julianday(${T}) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) AS days_in_status, link
FROM portal_items WHERE active = 1 AND kind = 'nr' AND status = 'Sent to Tenant' ORDER BY days_in_status DESC`],
  ["hub", "ABC Connect · Penalties in review",
   `SELECT site AS flagship, name, tenant, type, subject, created_day, status_since,
  CAST(julianday(${T}) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) AS days_in_status, link
FROM portal_items WHERE active = 1 AND kind = 'bp' AND status = 'In Review' ORDER BY days_in_status DESC`],
  ["hub", "ABC Connect · Violations sent to tenant",
   `SELECT site AS flagship, name, tenant, type, subject, created_day, status_since,
  CAST(julianday(${T}) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) AS days_in_status, link
FROM portal_items WHERE active = 1 AND kind = 'vr' AND status = 'Sent to Tenant' ORDER BY days_in_status DESC`],
  ["hub", "ABC Connect · Open items per tenant",
   `SELECT site AS flagship, tenant, SUM(kind = 'nr') AS requests, SUM(kind = 'bp') AS penalties, SUM(kind = 'vr') AS violations, COUNT(*) AS total
FROM portal_items WHERE active = 1 AND ((kind = 'nr' AND status = 'Sent to Tenant') OR (kind = 'bp' AND status = 'In Review') OR (kind = 'vr' AND status = 'Sent to Tenant'))
GROUP BY site, tenant ORDER BY total DESC`],
  ["hub", "ABC Connect · Marketing requests today and tomorrow",
   `SELECT site AS flagship, name, tenant, type, status, valid_from, valid_to, subject, link
FROM portal_items WHERE active = 1 AND kind = 'mk' AND COALESCE(NULLIF(valid_from, ''), created_day) <= date(${T}, '+1 day') AND COALESCE(NULLIF(valid_to, ''), valid_from, created_day) >= ${T}
ORDER BY site, valid_from`],
  ["hub", "ABC Connect · Portal users not signed in for 30+ days",
   `SELECT site AS flagship, company, first, last, title, username, last_login
FROM portal_users WHERE active = 1 AND (last_login IS NULL OR last_login = '' OR last_login < date(${T}, '-30 days')) ORDER BY site, company`],
  ["hub", "Contracts · Ending in the next 90 days",
   `SELECT site AS flagship, tenant, account, contract_no, status, end_day, departure_day,
  CAST(julianday(end_day) - julianday(${T}) AS INTEGER) AS days_left, note
FROM contracts_ending WHERE active = 1 AND end_day BETWEEN ${T} AND date(${T}, '+90 days') ORDER BY end_day`],

  ["hub", "Tenants · Units by status per flagship",
   `SELECT site AS flagship, status, COUNT(*) AS units, ROUND(SUM(CAST(area AS REAL)), 1) AS area_sqm
FROM gla_units WHERE active = 1 GROUP BY site, status ORDER BY site, status`],
  ["hub", "Tenants · Vacant units",
   `SELECT site AS flagship, level, code, area, section, dept, updated_at
FROM gla_units WHERE active = 1 AND status = 'Vacant' ORDER BY site, level, code`],
  ["hub", "Tenants · Unit changes, last 90 days",
   `SELECT eff_date, site AS flagship, unit_id, kind, before, after, note, by_name
FROM gla_events WHERE eff_date >= date(${T}, '-90 days') ORDER BY eff_date DESC`],
  ["hub", "Tenants · Directory contacts",
   `SELECT site AS flagship, tenant, unit_id, employee, position, mobile, email, category, status
FROM dir_contacts ORDER BY site, tenant`],
  ["hub", "Tenants · Feedback, last 30 days",
   `SELECT day, site AS flagship, tenant, category, description, action, action_desc, created_name
FROM tenant_feedback WHERE day >= date(${T}, '-29 days') ORDER BY day DESC`],
  ["hub", "Tenants · Fit-out works forms not completed",
   `SELECT site AS flagship, tenant, unit, level, type, status, from_name, received_at
FROM works_forms WHERE deleted = 0 AND status <> 'done' ORDER BY received_at DESC`],

  ["hub", "Contractors · Insurance expired or expiring in 30 days",
   `SELECT site AS flagship, company, trade, contact, mobile, ins_expiry, CAST(julianday(ins_expiry) - julianday(${T}) AS INTEGER) AS days_left
FROM contractors WHERE deleted = 0 AND status = 'Active' AND ins_expiry <> '' AND ins_expiry <= date(${T}, '+30 days') ORDER BY ins_expiry`],
  ["hub", "Contractors · Visits planned today",
   `SELECT site AS flagship, company, tenant, work, time_from, time_to, req, day_from, day_to
FROM contractor_visits WHERE deleted = 0 AND day_from <= ${T} AND day_to >= ${T} ORDER BY site, time_from`],
  ["hub", "Gate · Scans today per flagship",
   `SELECT site AS flagship, SUM(decision = 'in') AS entries, SUM(decision = 'out') AS exits, SUM(COALESCE(override, '') <> '') AS overrides, COUNT(*) AS scans
FROM gate_scans WHERE day = ${T} GROUP BY site ORDER BY site`],
  ["hub", "Gate · Manual overrides, last 30 days",
   `SELECT at, site AS flagship, decision, reason, override, tenant, contractor, work, by_name
FROM gate_scans WHERE COALESCE(override, '') <> '' AND day >= date(${T}, '-29 days') ORDER BY at DESC`],
  ["hub", "Gate · Quick passes, last 30 days",
   `SELECT day, site AS flagship, name, company, tenant, reason, status, req_name, dec_name, used_at
FROM quick_passes WHERE COALESCE(day, substr(req_at, 1, 10)) >= date(${T}, '-29 days') ORDER BY req_at DESC`],

  ["hub", "Cleaners · Registered workers by flagship and company",
   `SELECT site AS flagship, company, SUM(status = 'Active') AS active, SUM(status = 'Suspended') AS suspended, COUNT(*) AS total
FROM cl_workers GROUP BY site, company ORDER BY site, total DESC`],
  ["hub", "Cleaners · Suspended workers",
   `SELECT site AS flagship, name, company, tenant, position, comment, updated_at, updated_by
FROM cl_workers WHERE status = 'Suspended' ORDER BY site, name`],
  ["hub", "Cleaners · Attendance today",
   `SELECT site AS flagship, company, COUNT(DISTINCT worker_id) AS workers, MIN(time) AS first_in, MAX(time) AS last_scan
FROM cl_attendance WHERE day = ${T} GROUP BY site, company ORDER BY site, workers DESC`],
  ["hub", "Cleaning QR · Jobs done today",
   `SELECT j.site AS flagship, j.floor, j.area, COALESCE(t.name, s.title) AS task, j.user_name, j.before_at, j.after_at
FROM cc_jobs j LEFT JOIN cc_tasks t ON t.id = j.task_id LEFT JOIN cc_special s ON s.id = j.special_id
WHERE j.day = ${T} ORDER BY j.site, j.after_at DESC`],

  ["hub", "Security · Patrol scans with issues, last 7 days",
   `SELECT s.at, s.site AS flagship, p.label AS point, p.area, s.guard, s.issues, s.note
FROM patrol_scans s LEFT JOIN patrol_points p ON p.id = s.point_id WHERE s.status = 'issue' AND s.day >= date(${T}, '-6 days') ORDER BY s.at DESC`],
  ["hub", "Security · Emergencies, last 90 days",
   `SELECT created_at, site AS flagship, type, location, status, created_name, closed_at, closed_name,
  ROUND((julianday(closed_at) - julianday(created_at)) * 1440) AS minutes_open, close_note
FROM emergencies WHERE created_at >= datetime('now', '-90 days') ORDER BY created_at DESC`],
  ["hub", "Key box · Keys out now",
   `SELECT site AS flagship, unit, keys, taker, company, phone, purpose, out_at, due_at,
  CASE WHEN due_at < datetime('now') THEN 'LATE' ELSE '' END AS late
FROM kb_moves WHERE back_at IS NULL OR back_at = '' ORDER BY out_at`],

  ["hub", "Maintenance · Open follow-up records",
   `SELECT r.site AS flagship, r.category, r.location, r.asset, r.description, r.priority, r.status, p.name AS provider, r.found_at,
  CAST(julianday('now') - julianday(r.found_at) AS INTEGER) AS days_open
FROM mf_records r LEFT JOIN mf_providers p ON p.id = r.provider_id
WHERE r.deleted = 0 AND r.status NOT IN ('Fixed', 'Closed') ORDER BY days_open DESC`],
  ["hub", "Preventive maintenance · Tenants not completed per cycle",
   `SELECT c.month, r.site AS flagship, r.brand, r.category, r.deadline, r.last_mail, r.breach_at
FROM pm_records r JOIN pm_cycles c ON c.id = r.cycle_id WHERE r.completed_at IS NULL OR r.completed_at = '' ORDER BY c.month DESC, r.site, r.brand`],
  ["hub", "Preventive maintenance · Certificates by status",
   `SELECT site AS flagship, status, COUNT(*) AS certificates FROM pm_certs GROUP BY site, status ORDER BY site, status`],

  ["hub", "QC · Audit packs received",
   `SELECT site AS flagship, dept, audit_id, start_day, end_day, score, received_at, closed_at, closed_by
FROM qc_packs ORDER BY received_at DESC`],
  ["hub", "QC · Action plan by status",
   `SELECT k.site AS flagship, k.dept, a.status, COUNT(*) AS actions, SUM(a.due < ${T} AND a.status NOT IN ('fixed', 'verified')) AS overdue
FROM qc_actions a JOIN qc_packs k ON k.id = a.pack_id GROUP BY k.site, k.dept, a.status ORDER BY 1, 2, 3`],

  ["hub", "Meetings · Open MoM action items",
   `SELECT a.site AS flagship, m.title AS meeting, m.meet_date, a.text AS action, a.owner_name, a.due,
  CASE WHEN a.due <> '' AND a.due < ${T} THEN 'OVERDUE' ELSE '' END AS late
FROM mom_actions a LEFT JOIN mom_meetings m ON m.id = a.meeting_id WHERE a.status <> 'Done' ORDER BY a.due`],
  ["hub", "Memos · Answers per memo",
   `SELECT m.ref, m.title, m.created_at, COUNT(t.id) AS sent_to, SUM(t.state = 'ack') AS acknowledged, SUM(t.state = 'reply') AS replied,
  SUM(COALESCE(t.state, '') = '') AS waiting
FROM memo_memos m LEFT JOIN memo_targets t ON t.memo_id = m.id GROUP BY m.id ORDER BY m.created_at DESC`],
  ["hub", "Marketing · Campaign answers",
   `SELECT c.title, c.start_day, c.end_day, COUNT(t.id) AS tenants, SUM(COALESCE(t.answer, '') <> '') AS answered, SUM(COALESCE(t.answer, '') = '') AS waiting
FROM mk_campaigns c LEFT JOIN mk_targets t ON t.campaign_id = c.id GROUP BY c.id ORDER BY c.created_at DESC`],
  ["hub", "Reminders · Active reminders",
   `SELECT site AS flagship, kind, title, at_time, every_min, until_time, days, scope, created_name
FROM reminders WHERE active = 1 ORDER BY site, at_time`],
  ["hub", "Reminders · Runs, last 7 days",
   `SELECT r.day, r.slot, r.site AS flagship, m.title, r.state, r.detail, r.pushed
FROM reminder_runs r LEFT JOIN reminders m ON m.id = r.reminder_id WHERE r.day >= date(${T}, '-6 days') ORDER BY r.day DESC, r.slot DESC`],
  ["hub", "Calendar · Next 30 days",
   `SELECT start_day, end_day, time_from, site AS flagship, kind, title, location, owner
FROM cal_items WHERE deleted = 0 AND start_day BETWEEN ${T} AND date(${T}, '+30 days') ORDER BY start_day, time_from`],
  ["hub", "Projects · Budget against spent",
   `SELECT site AS flagship, title, stage, owner, contractor, due_day, progress, budget, spent, ROUND(budget - spent, 2) AS remaining, currency
FROM projects WHERE deleted = 0 ORDER BY site, due_day`],
  ["hub", "Budget · Budget and used per flagship and year",
   `SELECT b.site AS flagship, b.year, b.kind, ROUND(SUM(b.budget), 2) AS budget,
  ROUND((SELECT COALESCE(SUM(u.amount), 0) FROM budget_uses u WHERE u.site = b.site AND u.year = b.year AND u.kind = b.kind), 2) AS used
FROM budget_lines b GROUP BY b.site, b.year, b.kind ORDER BY b.year DESC, b.site`],
  ["hub", "Training · Expired or expiring in 30 days",
   `SELECT r.site AS flagship, p.name, p.role, c.name AS course, r.done_on, r.expires_on, CAST(julianday(r.expires_on) - julianday(${T}) AS INTEGER) AS days_left
FROM tr_records r JOIN tr_people p ON p.id = r.person JOIN tr_courses c ON c.id = r.course_id
WHERE p.active = 1 AND r.expires_on <> '' AND r.expires_on <= date(${T}, '+30 days') ORDER BY r.expires_on`],
  ["hub", "Footfall · Daily entries, last 30 days",
   `SELECT day, site AS flagship, entries, exits, employees, free, membership FROM ff_days WHERE day >= date(${T}, '-29 days') ORDER BY day DESC, site`],
  ["hub", "Schedule · This week's shifts",
   `SELECT s.site AS flagship, s.day, COALESCE(u.full_name, s.email) AS person, s.val AS shift
FROM sched_cells s LEFT JOIN users u ON u.email = s.email WHERE s.day BETWEEN date(${T}, 'weekday 1', '-7 days') AND date(${T}, 'weekday 0')
ORDER BY s.site, person, s.day`],
  ["hub", "Email · Outlook queue not sent",
   `SELECT created_at, sender, status, tries, error FROM ms_queue WHERE status <> 'sent' ORDER BY created_at DESC`],
  ["hub", "Email · Report mailbox imports, last 14 days",
   `SELECT received, subject, sender, files, result, ok FROM mb_log WHERE received >= datetime('now', '-14 days') ORDER BY received DESC`],
  ["hub", "System · Hub events, last 7 days",
   `SELECT at, site AS flagship, app, title, body, tone FROM hub_events WHERE at >= datetime('now', '-7 days') ORDER BY at DESC`],
  ["hub", "System · Announcements running now",
   `SELECT site AS flagship, level, message, starts_at, ends_at, created_by FROM announcements
WHERE (starts_at IS NULL OR starts_at <= datetime('now')) AND (ends_at IS NULL OR ends_at >= datetime('now')) ORDER BY starts_at DESC`],

  /* ================= RESTROOM ================= */
  ["restroom", "Inspections · Today per flagship and window",
   `SELECT flagship, window_id, window_display, COUNT(*) AS ops_inspections, SUM(has_issues) AS with_issues
FROM inspection_logs WHERE log_date = ${T} GROUP BY flagship, window_id ORDER BY flagship, window_id`],
  ["restroom", "Inspections · Rooms not inspected today by Operations",
   `WITH r AS (SELECT DISTINCT flagship, room_id, room_name FROM inspection_logs WHERE log_date >= date(${T}, '-30 days'))
SELECT r.flagship, r.room_name FROM r
WHERE NOT EXISTS (SELECT 1 FROM inspection_logs i WHERE i.flagship = r.flagship AND i.room_id = r.room_id AND i.log_date = ${T})
ORDER BY r.flagship, r.room_name`],
  ["restroom", "Inspections · Per flagship per day, last 14 days",
   `SELECT log_date, flagship, COUNT(*) AS inspections, SUM(has_issues) AS with_issues, COUNT(DISTINCT room_id) AS rooms
FROM inspection_logs WHERE log_date >= date(${T}, '-13 days') GROUP BY log_date, flagship ORDER BY log_date DESC, flagship`],
  ["restroom", "Inspections · Issues found, last 7 days",
   `SELECT log_date, log_time, flagship, room_name, window_label, supervisor, equipment_issues, cleaning_issues, comments
FROM inspection_logs WHERE has_issues = 1 AND log_date >= date(${T}, '-6 days') ORDER BY log_date DESC, log_time DESC`],
  ["restroom", "Inspections · Issue rate per room, last 30 days",
   `SELECT flagship, room_name, COUNT(*) AS inspections, SUM(has_issues) AS with_issues, ROUND(100.0 * SUM(has_issues) / COUNT(*), 1) AS issue_pct
FROM inspection_logs WHERE log_date >= date(${T}, '-29 days') GROUP BY flagship, room_id ORDER BY issue_pct DESC`],
  ["restroom", "Inspections · Per supervisor, last 30 days",
   `SELECT flagship, supervisor, role, COUNT(*) AS inspections, COUNT(DISTINCT log_date) AS days, MAX(log_date) AS last_day
FROM inspection_logs WHERE log_date >= date(${T}, '-29 days') GROUP BY flagship, supervisor ORDER BY flagship, inspections DESC`],
  ["restroom", "Inspections · Location (GPS) not confirmed, last 30 days",
   `SELECT log_date, log_time, flagship, room_name, supervisor, gps_status, gps_accuracy
FROM inspection_logs WHERE gps_status <> 'obtained' AND log_date >= date(${T}, '-29 days') ORDER BY log_date DESC`],
  ["restroom", "Soft services · Checks today per flagship and window",
   `SELECT flagship, company, window_id, window_display, COUNT(*) AS checks, SUM(has_issues) AS with_issues
FROM softservices_logs WHERE log_date = ${T} GROUP BY flagship, company, window_id ORDER BY flagship, window_id`],
  ["restroom", "Soft services · Per company, last 30 days",
   `SELECT flagship, company, COUNT(*) AS checks, SUM(has_issues) AS with_issues, ROUND(100.0 * SUM(has_issues) / COUNT(*), 1) AS issue_pct, COUNT(DISTINCT log_date) AS days
FROM softservices_logs WHERE log_date >= date(${T}, '-29 days') GROUP BY flagship, company ORDER BY flagship, company`],
  ["restroom", "Soft services · Issues found, last 7 days",
   `SELECT log_date, log_time, flagship, company, room_name, supervisor, cleaning_issues, comments
FROM softservices_logs WHERE has_issues = 1 AND log_date >= date(${T}, '-6 days') ORDER BY log_date DESC, log_time DESC`],
  ["restroom", "Emails · Reminders and reports sent, last 7 days",
   `SELECT report_date, flagship, report_type, status, email_to, sent_at
FROM shift_reports WHERE report_date >= date(${T}, '-6 days') ORDER BY report_date DESC, flagship, report_type`],
  ["restroom", "Emails · Failed reports, last 30 days",
   `SELECT report_date, flagship, report_type, email_to, subject, sent_at
FROM shift_reports WHERE status = 'failed' AND report_date >= date(${T}, '-29 days') ORDER BY report_date DESC`],
  ["restroom", "Emails · Outbox not sent",
   `SELECT created_at, kind, to_list, subject, status, tries, last_error FROM email_outbox WHERE status <> 'sent' ORDER BY created_at DESC`],

  /* ================= INCIDENTS ================= */
  ["incidents", "Incidents · Still open",
   `SELECT ref, incident_date, flagship, category, type, severity, status, incident_owner, follow_up_date, reported_by_name
FROM incidents WHERE status <> 'Closed' ORDER BY incident_date DESC`],
  ["incidents", "Incidents · Last 30 days",
   `SELECT ref, incident_date, incident_time, flagship, category, type, severity, status, person_type, reported_by_name
FROM incidents WHERE incident_date >= date(${T}, '-29 days') ORDER BY incident_date DESC, incident_time DESC`],
  ["incidents", "Incidents · Count by flagship, category and severity (this year)",
   `SELECT flagship, category, severity, COUNT(*) AS incidents, SUM(status = 'Closed') AS closed
FROM incidents WHERE substr(incident_date, 1, 4) = strftime('%Y', 'now') GROUP BY 1, 2, 3 ORDER BY 1, incidents DESC`],
  ["incidents", "Incidents · Per month",
   `SELECT substr(incident_date, 1, 7) AS month, flagship, COUNT(*) AS incidents FROM incidents GROUP BY 1, 2 ORDER BY 1 DESC, 2`],
  ["incidents", "Incidents · Follow-ups due",
   `SELECT ref, follow_up_date, flagship, type, severity, status, incident_owner
FROM incidents WHERE status <> 'Closed' AND follow_up_date <> '' AND follow_up_date <= ${T} ORDER BY follow_up_date`],
  ["incidents", "Incidents · Escalation breaches",
   `SELECT ref, incident_date, flagship, type, severity, status, escalation_triggers, escalated_at, breach_alert_sent_at
FROM incidents WHERE COALESCE(escalation_breach, '') NOT IN ('', '0', 0) ORDER BY incident_date DESC`],
  ["incidents", "Incidents · Major / critical without post-incident report",
   `SELECT i.ref, i.incident_date, i.flagship, i.type, i.severity, i.status, i.incident_owner
FROM incidents i LEFT JOIN post_incident_reports p ON p.ref = i.ref
WHERE (i.severity LIKE 'Major%' OR i.severity LIKE 'Critical%') AND p.ref IS NULL ORDER BY i.incident_date DESC`],
  ["incidents", "Blacklist · Current entries",
   `SELECT date_added, flagship, name, person_type, reason, access_status, date_from, date_to, cctv_notified_at
FROM blacklist WHERE COALESCE(date_to, '') = '' OR date_to >= ${T} ORDER BY date_added DESC`],
  ["incidents", "Users · Incident system users",
   `SELECT full_name, email, role, position, flagship_scope, active, created_at FROM users ORDER BY active DESC, role, full_name`],
  ["incidents", "Activity · Log, last 7 days",
   `SELECT at, actor_name, action, target_ref, details FROM audit_log WHERE at >= datetime('now', '-7 days') ORDER BY at DESC`],

  /* ================= SNAGLIST ================= */
  ["snaglist", "Snaglists · Per flagship and status",
   `SELECT site AS flagship, COALESCE(NULLIF(kind, ''), 'snaglist') AS kind, status, COUNT(*) AS lists, SUM(item_count) AS items
FROM lists WHERE deleted = 0 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`],
  ["snaglist", "Snaglists · Per owner",
   `SELECT l.site AS flagship, COALESCE(u.full_name, l.owner_email) AS owner, COUNT(*) AS lists, SUM(l.item_count) AS items, MAX(l.updated_at) AS last_update
FROM lists l LEFT JOIN users u ON u.email = l.owner_email WHERE l.deleted = 0 GROUP BY l.owner_email ORDER BY lists DESC`],
  ["snaglist", "Snaglists · Open site visits and progress",
   `SELECT l.site AS flagship, l.list_name, COALESCE(u.full_name, l.owner_email) AS owner, l.submitted_at,
  (SELECT COUNT(*) FROM items i WHERE i.list_id = l.list_id AND i.deleted = 0) AS items,
  (SELECT COUNT(*) FROM items i WHERE i.list_id = l.list_id AND i.deleted = 0 AND i.item_status = 'Solved') AS solved
FROM lists l LEFT JOIN users u ON u.email = l.owner_email
WHERE l.deleted = 0 AND l.kind = 'site_visit' AND COALESCE(l.closed_at, '') = '' ORDER BY l.submitted_at`],
  ["snaglist", "Snaglists · Items not solved",
   `SELECT l.site AS flagship, l.list_name, i.seq, i.location, i.issue, COALESCE(NULLIF(i.item_status, ''), 'Pending') AS item_status, i.updated_at
FROM items i JOIN lists l ON l.list_id = i.list_id
WHERE i.deleted = 0 AND l.deleted = 0 AND COALESCE(i.item_status, '') <> 'Solved' ORDER BY l.site, l.list_name, i.seq`],
  ["snaglist", "Snaglists · Not updated for 30+ days",
   `SELECT site AS flagship, list_name, status, item_count, owner_email, updated_at, CAST(julianday('now') - julianday(updated_at) AS INTEGER) AS idle_days
FROM lists WHERE deleted = 0 AND updated_at < datetime('now', '-30 days') ORDER BY updated_at`],
  ["snaglist", "Snaglists · Close to the 3-month clean-up",
   `SELECT site AS flagship, list_name, owner_email, updated_at, date(updated_at, '+3 months') AS removed_on
FROM lists WHERE deleted = 0 AND retention_hold = 0 AND updated_at < datetime('now', '-75 days') ORDER BY updated_at`],
  ["snaglist", "Snaglists · Transfers, last 90 days",
   `SELECT t.at, l.site AS flagship, l.list_name, t.from_email, t.to_email, t.note
FROM transfers t LEFT JOIN lists l ON l.list_id = t.list_id WHERE t.at >= datetime('now', '-90 days') ORDER BY t.at DESC`],
  ["snaglist", "Snaglists · Photo storage per flagship",
   `SELECT l.site AS flagship, COUNT(*) AS photos, ROUND(SUM(p.size) / 1048576.0, 1) AS mb
FROM photos p JOIN lists l ON l.list_id = p.list_id GROUP BY l.site ORDER BY mb DESC`],
  ["snaglist", "Users · Snaglist users",
   `SELECT site_code AS flagship, role, position_title, full_name, email, active, last_login_at FROM users ORDER BY active DESC, site_code, role, full_name`],
  ["snaglist", "Activity · Log, last 7 days",
   `SELECT at, site AS flagship, email, action, detail FROM audit WHERE at >= datetime('now', '-7 days') ORDER BY at DESC`],

  /* ================= ABC AUDIT ================= */
  ["audit", "Audits · All audits",
   `SELECT id, site, type, start, end_date, status, report_issued, submitted_at, shared_at, created_by FROM audits ORDER BY start DESC`],
  ["audit", "Audits · Progress (answers and cards submitted)",
   `SELECT a.id, a.site, a.status, a.start, a.end_date,
  (SELECT COUNT(*) FROM responses r WHERE r.audit_id = a.id) AS answers,
  (SELECT COUNT(*) FROM submissions s WHERE s.audit_id = a.id) AS cards_submitted,
  (SELECT COUNT(*) FROM findings f WHERE f.audit_id = a.id) AS findings
FROM audits a ORDER BY a.start DESC`],
  ["audit", "Findings · Open by flagship and grade",
   `SELECT site, grade, COUNT(*) AS findings FROM findings WHERE status <> 'Closed' GROUP BY site, grade ORDER BY site, findings DESC`],
  ["audit", "Findings · Critical still open",
   `SELECT audit_id, site, area, sub, loc, text, comment, resp, due, status, created
FROM findings WHERE grade = 'Critical' AND status <> 'Closed' ORDER BY due`],
  ["audit", "Findings · Overdue",
   `SELECT audit_id, site, area, loc, grade, text, resp, due, status, CAST(julianday(${T}) - julianday(due) AS INTEGER) AS days_late
FROM findings WHERE status <> 'Closed' AND COALESCE(due, '') <> '' AND due < ${T} ORDER BY days_late DESC`],
  ["audit", "Findings · Per audit by status",
   `SELECT audit_id, site, status, COUNT(*) AS findings FROM findings GROUP BY audit_id, status ORDER BY audit_id DESC, status`],
  ["audit", "Findings · Repeated findings",
   `SELECT audit_id, site, area, loc, grade, text, status FROM findings WHERE "repeat" = 1 ORDER BY site, area`],
  ["audit", "Findings · By area (all audits)",
   `SELECT site, area, COUNT(*) AS findings, SUM(grade = 'Critical') AS critical, SUM(status <> 'Closed') AS still_open
FROM findings GROUP BY site, area ORDER BY findings DESC`],
  ["audit", "Audits · Shared reports",
   `SELECT s.at, s.audit_id, a.site, s.part, s.by_user FROM shares s LEFT JOIN audits a ON a.id = s.audit_id ORDER BY s.at DESC`],
  ["audit", "Users · Audit system users",
   `SELECT name, email, role, active, last_login_at, created_at FROM users ORDER BY active DESC, role, name`],
  ["audit", "Activity · Log, last 7 days",
   `SELECT t, user, action, detail FROM log WHERE t >= datetime('now', '-7 days') ORDER BY t DESC`],
];
