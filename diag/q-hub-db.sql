SELECT COUNT(*) AS n FROM (SELECT site_code AS flagship, role, position, full_name, email, mobile, last_login_at, last_seen_at
FROM users WHERE active = 1 ORDER BY site_code, role, position, full_name);
SELECT COUNT(*) AS n FROM (SELECT COALESCE(site_code, 'All') AS flagship, role, position, COUNT(*) AS people
FROM users WHERE active = 1 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3);
SELECT COUNT(*) AS n FROM (SELECT site_code AS flagship, position, full_name, email, created_at
FROM users WHERE active = 1 AND (last_login_at IS NULL OR last_login_at = '') ORDER BY site_code, full_name);
SELECT COUNT(*) AS n FROM (SELECT site_code AS flagship, position, full_name, email, last_seen_at,
  CAST(julianday('now') - julianday(last_seen_at) AS INTEGER) AS days_away
FROM users WHERE active = 1 AND last_seen_at < datetime('now', '-30 days') ORDER BY days_away DESC);
SELECT COUNT(*) AS n FROM (SELECT site_code AS flagship, full_name, email, fail_count, locked_until, twofa_fail, twofa_lock
FROM users WHERE COALESCE(fail_count, 0) > 0 OR COALESCE(twofa_fail, 0) > 0 OR locked_until > datetime('now') OR COALESCE(twofa_lock, '') <> ''
ORDER BY fail_count DESC);
SELECT COUNT(*) AS n FROM (SELECT u.site_code AS flagship, u.full_name, u.email,
  CASE WHEN COALESCE(t.totp_on, 0) = 1 THEN 'Yes' ELSE '' END AS authenticator_app,
  CASE WHEN COALESCE(t.email_on, 0) = 1 THEN 'Yes' ELSE '' END AS email_code,
  (SELECT COUNT(*) FROM user_passkeys p WHERE p.email = u.email) AS passkeys
FROM users u LEFT JOIN user_2fa t ON t.email = u.email WHERE u.active = 1 ORDER BY u.site_code, u.full_name);
SELECT COUNT(*) AS n FROM (SELECT app AS tool, COUNT(*) AS opens, COUNT(DISTINCT email) AS people, MAX(at) AS last_open
FROM usage_log WHERE at >= datetime('now', '-30 days') GROUP BY app ORDER BY opens DESC);
SELECT COUNT(*) AS n FROM (SELECT l.site AS flagship, COALESCE(u.full_name, l.email) AS person, l.role, COUNT(*) AS opens,
  COUNT(DISTINCT l.app) AS tools, COUNT(DISTINCT date(l.at)) AS active_days, MAX(l.at) AS last_open
FROM usage_log l LEFT JOIN users u ON u.email = l.email WHERE l.at >= datetime('now', '-30 days')
GROUP BY l.email ORDER BY opens DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, app AS tool, COUNT(*) AS opens, COUNT(DISTINCT email) AS people
FROM usage_log WHERE at >= datetime('now', '-30 days') GROUP BY site, app ORDER BY site, opens DESC);
SELECT COUNT(*) AS n FROM (SELECT date(at, '+2 hours') AS day, COUNT(DISTINCT email) AS people, COUNT(*) AS opens
FROM usage_log WHERE at >= datetime('now', '-30 days') GROUP BY 1 ORDER BY 1 DESC);
SELECT COUNT(*) AS n FROM (SELECT u.site_code AS flagship, u.position, u.full_name, u.email
FROM users u WHERE u.active = 1 AND NOT EXISTS (SELECT 1 FROM usage_log l WHERE l.email = u.email AND l.at >= datetime('now', '-30 days'))
ORDER BY u.site_code, u.full_name);
SELECT COUNT(*) AS n FROM (SELECT at, email, ok, what, ip FROM admin_signins WHERE at >= datetime('now', '-30 days') ORDER BY at DESC);
SELECT COUNT(*) AS n FROM (SELECT at, site AS flagship, tool, label, action, by_name, changes
FROM change_log WHERE at >= datetime('now', '-7 days') ORDER BY at DESC);
SELECT COUNT(*) AS n FROM (SELECT substr(day, 1, 7) AS month, site AS flagship, shift, COUNT(*) AS submitted
FROM handovers WHERE status = 'submitted' GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3);
SELECT COUNT(*) AS n FROM (WITH RECURSIVE d(day) AS (SELECT date(date('now','+2 hours'), '-13 days') UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < date('now','+2 hours')), s(site) AS (VALUES ('VRM'),('VRS'),('ACM'),('ACS'),('DBS'))
SELECT s.site AS flagship, d.day FROM s, d
WHERE NOT EXISTS (SELECT 1 FROM handovers h WHERE h.site = s.site AND h.day = d.day AND h.status = 'submitted')
ORDER BY s.site, d.day DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, day, shift, created_name, created_at, updated_at
FROM handovers WHERE status = 'draft' AND day < date('now','+2 hours') ORDER BY day DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, day, shift, created_name, submitted_at
FROM handovers WHERE status = 'submitted' AND (received_at IS NULL OR received_at = '') ORDER BY day DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, SUM(form = 'am') AS am, SUM(form = 'pm') AS pm, SUM(form = 'open') AS opening, SUM(issues) AS issues_found
FROM form_runs WHERE status = 'submitted' AND day >= date(date('now','+2 hours'), '-29 days') GROUP BY site ORDER BY site);
SELECT COUNT(*) AS n FROM (WITH RECURSIVE d(day) AS (SELECT date(date('now','+2 hours'), '-13 days') UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < date('now','+2 hours')), s(site) AS (VALUES ('VRM'),('VRS'),('ACM'),('ACS'),('DBS')), f(form) AS (VALUES ('am'),('pm'))
SELECT s.site AS flagship, d.day, upper(f.form) AS checklist FROM s, d, f
WHERE NOT EXISTS (SELECT 1 FROM form_runs r WHERE r.site = s.site AND r.day = d.day AND r.form = f.form AND r.status = 'submitted')
ORDER BY s.site, d.day DESC, f.form);
SELECT COUNT(*) AS n FROM (SELECT day, site AS flagship, upper(form) AS checklist, issues, done, total, submitted_name, submitted_at
FROM form_runs WHERE status = 'submitted' AND day >= date(date('now','+2 hours'), '-29 days') ORDER BY day DESC, site);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, upper(form) AS checklist, day, done, total, created_name, updated_at
FROM form_runs WHERE status = 'draft' ORDER BY day DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, upper(form) AS checklist, item_id, note, by_name, at FROM form_fixes ORDER BY at DESC);
SELECT COUNT(*) AS n FROM (SELECT at, site AS flagship, upper(form) AS checklist, day, item_text, remark, result, by_name
FROM form_trig_log WHERE at >= datetime('now', '-30 days') ORDER BY at DESC);
SELECT COUNT(*) AS n FROM (SELECT CASE kind WHEN 'nr' THEN 'ABC Requests' WHEN 'bp' THEN 'Penalties' WHEN 'vr' THEN 'Violations' WHEN 'mk' THEN 'Marketing Requests' WHEN 'cp' THEN 'Contractor Permits' ELSE kind END AS type,
  status, COUNT(*) AS items, SUM(CAST(julianday(date('now','+2 hours')) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) > 7) AS over_7_days
FROM portal_items WHERE active = 1 GROUP BY kind, status ORDER BY kind, items DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship,
  SUM(kind = 'nr' AND status = 'Sent to Tenant') AS abc_requests_open,
  SUM(kind = 'bp' AND status = 'In Review') AS penalties_in_review,
  SUM(kind = 'vr' AND status = 'Sent to Tenant') AS violations_open,
  SUM((kind = 'nr' AND status = 'Sent to Tenant') OR (kind = 'bp' AND status = 'In Review') OR (kind = 'vr' AND status = 'Sent to Tenant')) AS total_pending
FROM portal_items WHERE active = 1 GROUP BY site ORDER BY site);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, name, tenant, type, subject, created_day, status_since,
  CAST(julianday(date('now','+2 hours')) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) AS days_in_status, link
FROM portal_items WHERE active = 1 AND kind = 'nr' AND status = 'Sent to Tenant' ORDER BY days_in_status DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, name, tenant, type, subject, created_day, status_since,
  CAST(julianday(date('now','+2 hours')) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) AS days_in_status, link
FROM portal_items WHERE active = 1 AND kind = 'bp' AND status = 'In Review' ORDER BY days_in_status DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, name, tenant, type, subject, created_day, status_since,
  CAST(julianday(date('now','+2 hours')) - julianday(COALESCE(NULLIF(status_since, ''), created_day)) AS INTEGER) AS days_in_status, link
FROM portal_items WHERE active = 1 AND kind = 'vr' AND status = 'Sent to Tenant' ORDER BY days_in_status DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, tenant, SUM(kind = 'nr') AS requests, SUM(kind = 'bp') AS penalties, SUM(kind = 'vr') AS violations, COUNT(*) AS total
FROM portal_items WHERE active = 1 AND ((kind = 'nr' AND status = 'Sent to Tenant') OR (kind = 'bp' AND status = 'In Review') OR (kind = 'vr' AND status = 'Sent to Tenant'))
GROUP BY site, tenant ORDER BY total DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, name, tenant, type, status, valid_from, valid_to, subject, link
FROM portal_items WHERE active = 1 AND kind = 'mk' AND COALESCE(NULLIF(valid_from, ''), created_day) <= date(date('now','+2 hours'), '+1 day') AND COALESCE(NULLIF(valid_to, ''), valid_from, created_day) >= date('now','+2 hours')
ORDER BY site, valid_from);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, company, first, last, title, username, last_login
FROM portal_users WHERE active = 1 AND (last_login IS NULL OR last_login = '' OR last_login < date(date('now','+2 hours'), '-30 days')) ORDER BY site, company);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, tenant, account, contract_no, status, end_day, departure_day,
  CAST(julianday(end_day) - julianday(date('now','+2 hours')) AS INTEGER) AS days_left, note
FROM contracts_ending WHERE active = 1 AND end_day BETWEEN date('now','+2 hours') AND date(date('now','+2 hours'), '+90 days') ORDER BY end_day);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, status, COUNT(*) AS units, ROUND(SUM(CAST(area AS REAL)), 1) AS area_sqm
FROM gla_units WHERE active = 1 GROUP BY site, status ORDER BY site, status);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, level, code, area, section, dept, updated_at
FROM gla_units WHERE active = 1 AND status = 'Vacant' ORDER BY site, level, code);
SELECT COUNT(*) AS n FROM (SELECT eff_date, site AS flagship, unit_id, kind, before, after, note, by_name
FROM gla_events WHERE eff_date >= date(date('now','+2 hours'), '-90 days') ORDER BY eff_date DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, tenant, unit_id, employee, position, mobile, email, category, status
FROM dir_contacts ORDER BY site, tenant);
SELECT COUNT(*) AS n FROM (SELECT day, site AS flagship, tenant, category, description, action, action_desc, created_name
FROM tenant_feedback WHERE day >= date(date('now','+2 hours'), '-29 days') ORDER BY day DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, tenant, unit, level, type, status, from_name, received_at
FROM works_forms WHERE deleted = 0 AND status <> 'done' ORDER BY received_at DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, company, trade, contact, mobile, ins_expiry, CAST(julianday(ins_expiry) - julianday(date('now','+2 hours')) AS INTEGER) AS days_left
FROM contractors WHERE deleted = 0 AND status = 'Active' AND ins_expiry <> '' AND ins_expiry <= date(date('now','+2 hours'), '+30 days') ORDER BY ins_expiry);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, company, tenant, work, time_from, time_to, req, day_from, day_to
FROM contractor_visits WHERE deleted = 0 AND day_from <= date('now','+2 hours') AND day_to >= date('now','+2 hours') ORDER BY site, time_from);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, SUM(decision = 'in') AS entries, SUM(decision = 'out') AS exits, SUM(COALESCE(override, '') <> '') AS overrides, COUNT(*) AS scans
FROM gate_scans WHERE day = date('now','+2 hours') GROUP BY site ORDER BY site);
SELECT COUNT(*) AS n FROM (SELECT at, site AS flagship, decision, reason, override, tenant, contractor, work, by_name
FROM gate_scans WHERE COALESCE(override, '') <> '' AND day >= date(date('now','+2 hours'), '-29 days') ORDER BY at DESC);
SELECT COUNT(*) AS n FROM (SELECT day, site AS flagship, name, company, tenant, reason, status, req_name, dec_name, used_at
FROM quick_passes WHERE COALESCE(day, substr(req_at, 1, 10)) >= date(date('now','+2 hours'), '-29 days') ORDER BY req_at DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, company, SUM(status = 'Active') AS active, SUM(status = 'Suspended') AS suspended, COUNT(*) AS total
FROM cl_workers GROUP BY site, company ORDER BY site, total DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, name, company, tenant, position, comment, updated_at, updated_by
FROM cl_workers WHERE status = 'Suspended' ORDER BY site, name);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, company, COUNT(DISTINCT worker_id) AS workers, MIN(time) AS first_in, MAX(time) AS last_scan
FROM cl_attendance WHERE day = date('now','+2 hours') GROUP BY site, company ORDER BY site, workers DESC);
SELECT COUNT(*) AS n FROM (SELECT j.site AS flagship, j.floor, j.area, COALESCE(t.name, s.title) AS task, j.user_name, j.before_at, j.after_at
FROM cc_jobs j LEFT JOIN cc_tasks t ON t.id = j.task_id LEFT JOIN cc_special s ON s.id = j.special_id
WHERE j.day = date('now','+2 hours') ORDER BY j.site, j.after_at DESC);
SELECT COUNT(*) AS n FROM (SELECT s.at, s.site AS flagship, p.label AS point, p.area, s.guard, s.issues, s.note
FROM patrol_scans s LEFT JOIN patrol_points p ON p.id = s.point_id WHERE s.status = 'issue' AND s.day >= date(date('now','+2 hours'), '-6 days') ORDER BY s.at DESC);
SELECT COUNT(*) AS n FROM (SELECT created_at, site AS flagship, type, location, status, created_name, closed_at, closed_name,
  ROUND((julianday(closed_at) - julianday(created_at)) * 1440) AS minutes_open, close_note
FROM emergencies WHERE created_at >= datetime('now', '-90 days') ORDER BY created_at DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, unit, keys, taker, company, phone, purpose, out_at, due_at,
  CASE WHEN due_at < datetime('now') THEN 'LATE' ELSE '' END AS late
FROM kb_moves WHERE back_at IS NULL OR back_at = '' ORDER BY out_at);
SELECT COUNT(*) AS n FROM (SELECT r.site AS flagship, r.category, r.location, r.asset, r.description, r.priority, r.status, p.name AS provider, r.found_at,
  CAST(julianday('now') - julianday(r.found_at) AS INTEGER) AS days_open
FROM mf_records r LEFT JOIN mf_providers p ON p.id = r.provider_id
WHERE r.deleted = 0 AND r.status NOT IN ('Fixed', 'Closed') ORDER BY days_open DESC);
SELECT COUNT(*) AS n FROM (SELECT c.month, r.site AS flagship, r.brand, r.category, r.deadline, r.last_mail, r.breach_at
FROM pm_records r JOIN pm_cycles c ON c.id = r.cycle_id WHERE r.completed_at IS NULL OR r.completed_at = '' ORDER BY c.month DESC, r.site, r.brand);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, status, COUNT(*) AS certificates FROM pm_certs GROUP BY site, status ORDER BY site, status);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, dept, audit_id, start_day, end_day, score, received_at, closed_at, closed_by
FROM qc_packs ORDER BY received_at DESC);
SELECT COUNT(*) AS n FROM (SELECT k.site AS flagship, k.dept, a.status, COUNT(*) AS actions, SUM(a.due < date('now','+2 hours') AND a.status NOT IN ('fixed', 'verified')) AS overdue
FROM qc_actions a JOIN qc_packs k ON k.id = a.pack_id GROUP BY k.site, k.dept, a.status ORDER BY 1, 2, 3);
SELECT COUNT(*) AS n FROM (SELECT a.site AS flagship, m.title AS meeting, m.meet_date, a.text AS action, a.owner_name, a.due,
  CASE WHEN a.due <> '' AND a.due < date('now','+2 hours') THEN 'OVERDUE' ELSE '' END AS late
FROM mom_actions a LEFT JOIN mom_meetings m ON m.id = a.meeting_id WHERE a.status <> 'Done' ORDER BY a.due);
SELECT COUNT(*) AS n FROM (SELECT m.ref, m.title, m.created_at, COUNT(t.id) AS sent_to, SUM(t.state = 'ack') AS acknowledged, SUM(t.state = 'reply') AS replied,
  SUM(COALESCE(t.state, '') = '') AS waiting
FROM memo_memos m LEFT JOIN memo_targets t ON t.memo_id = m.id GROUP BY m.id ORDER BY m.created_at DESC);
SELECT COUNT(*) AS n FROM (SELECT c.title, c.start_day, c.end_day, COUNT(t.id) AS tenants, SUM(COALESCE(t.answer, '') <> '') AS answered, SUM(COALESCE(t.answer, '') = '') AS waiting
FROM mk_campaigns c LEFT JOIN mk_targets t ON t.campaign_id = c.id GROUP BY c.id ORDER BY c.created_at DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, kind, title, at_time, every_min, until_time, days, scope, created_name
FROM reminders WHERE active = 1 ORDER BY site, at_time);
SELECT COUNT(*) AS n FROM (SELECT r.day, r.slot, r.site AS flagship, m.title, r.state, r.detail, r.pushed
FROM reminder_runs r LEFT JOIN reminders m ON m.id = r.reminder_id WHERE r.day >= date(date('now','+2 hours'), '-6 days') ORDER BY r.day DESC, r.slot DESC);
SELECT COUNT(*) AS n FROM (SELECT start_day, end_day, time_from, site AS flagship, kind, title, location, owner
FROM cal_items WHERE deleted = 0 AND start_day BETWEEN date('now','+2 hours') AND date(date('now','+2 hours'), '+30 days') ORDER BY start_day, time_from);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, title, stage, owner, contractor, due_day, progress, budget, spent, ROUND(budget - spent, 2) AS remaining, currency
FROM projects WHERE deleted = 0 ORDER BY site, due_day);
SELECT COUNT(*) AS n FROM (SELECT b.site AS flagship, b.year, b.kind, ROUND(SUM(b.budget), 2) AS budget,
  ROUND((SELECT COALESCE(SUM(u.amount), 0) FROM budget_uses u WHERE u.site = b.site AND u.year = b.year AND u.kind = b.kind), 2) AS used
FROM budget_lines b GROUP BY b.site, b.year, b.kind ORDER BY b.year DESC, b.site);
SELECT COUNT(*) AS n FROM (SELECT r.site AS flagship, p.name, p.role, c.name AS course, r.done_on, r.expires_on, CAST(julianday(r.expires_on) - julianday(date('now','+2 hours')) AS INTEGER) AS days_left
FROM tr_records r JOIN tr_people p ON p.id = r.person JOIN tr_courses c ON c.id = r.course_id
WHERE p.active = 1 AND r.expires_on <> '' AND r.expires_on <= date(date('now','+2 hours'), '+30 days') ORDER BY r.expires_on);
SELECT COUNT(*) AS n FROM (SELECT day, site AS flagship, entries, exits, employees, free, membership FROM ff_days WHERE day >= date(date('now','+2 hours'), '-29 days') ORDER BY day DESC, site);
SELECT COUNT(*) AS n FROM (SELECT s.site AS flagship, s.day, COALESCE(u.full_name, s.email) AS person, s.val AS shift
FROM sched_cells s LEFT JOIN users u ON u.email = s.email WHERE s.day BETWEEN date(date('now','+2 hours'), 'weekday 1', '-7 days') AND date(date('now','+2 hours'), 'weekday 0')
ORDER BY s.site, person, s.day);
SELECT COUNT(*) AS n FROM (SELECT created_at, sender, status, tries, error FROM ms_queue WHERE status <> 'sent' ORDER BY created_at DESC);
SELECT COUNT(*) AS n FROM (SELECT received, subject, sender, files, result, ok FROM mb_log WHERE received >= datetime('now', '-14 days') ORDER BY received DESC);
SELECT COUNT(*) AS n FROM (SELECT at, site AS flagship, app, title, body, tone FROM hub_events WHERE at >= datetime('now', '-7 days') ORDER BY at DESC);
SELECT COUNT(*) AS n FROM (SELECT site AS flagship, level, message, starts_at, ends_at, created_by FROM announcements
WHERE (starts_at IS NULL OR starts_at <= datetime('now')) AND (ends_at IS NULL OR ends_at >= datetime('now')) ORDER BY starts_at DESC);