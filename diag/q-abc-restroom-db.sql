SELECT COUNT(*) AS n FROM (SELECT flagship, window_id, window_display, COUNT(*) AS ops_inspections, SUM(has_issues) AS with_issues
FROM inspection_logs WHERE log_date = date('now','+2 hours') GROUP BY flagship, window_id ORDER BY flagship, window_id);
SELECT COUNT(*) AS n FROM (WITH r AS (SELECT DISTINCT flagship, room_id, room_name FROM inspection_logs WHERE log_date >= date(date('now','+2 hours'), '-30 days'))
SELECT r.flagship, r.room_name FROM r
WHERE NOT EXISTS (SELECT 1 FROM inspection_logs i WHERE i.flagship = r.flagship AND i.room_id = r.room_id AND i.log_date = date('now','+2 hours'))
ORDER BY r.flagship, r.room_name);
SELECT COUNT(*) AS n FROM (SELECT log_date, flagship, COUNT(*) AS inspections, SUM(has_issues) AS with_issues, COUNT(DISTINCT room_id) AS rooms
FROM inspection_logs WHERE log_date >= date(date('now','+2 hours'), '-13 days') GROUP BY log_date, flagship ORDER BY log_date DESC, flagship);
SELECT COUNT(*) AS n FROM (SELECT log_date, log_time, flagship, room_name, window_label, supervisor, equipment_issues, cleaning_issues, comments
FROM inspection_logs WHERE has_issues = 1 AND log_date >= date(date('now','+2 hours'), '-6 days') ORDER BY log_date DESC, log_time DESC);
SELECT COUNT(*) AS n FROM (SELECT flagship, room_name, COUNT(*) AS inspections, SUM(has_issues) AS with_issues, ROUND(100.0 * SUM(has_issues) / COUNT(*), 1) AS issue_pct
FROM inspection_logs WHERE log_date >= date(date('now','+2 hours'), '-29 days') GROUP BY flagship, room_id ORDER BY issue_pct DESC);
SELECT COUNT(*) AS n FROM (SELECT flagship, supervisor, role, COUNT(*) AS inspections, COUNT(DISTINCT log_date) AS days, MAX(log_date) AS last_day
FROM inspection_logs WHERE log_date >= date(date('now','+2 hours'), '-29 days') GROUP BY flagship, supervisor ORDER BY flagship, inspections DESC);
SELECT COUNT(*) AS n FROM (SELECT log_date, log_time, flagship, room_name, supervisor, gps_status, gps_accuracy
FROM inspection_logs WHERE gps_status <> 'obtained' AND log_date >= date(date('now','+2 hours'), '-29 days') ORDER BY log_date DESC);
SELECT COUNT(*) AS n FROM (SELECT flagship, company, window_id, window_display, COUNT(*) AS checks, SUM(has_issues) AS with_issues
FROM softservices_logs WHERE log_date = date('now','+2 hours') GROUP BY flagship, company, window_id ORDER BY flagship, window_id);
SELECT COUNT(*) AS n FROM (SELECT flagship, company, COUNT(*) AS checks, SUM(has_issues) AS with_issues, ROUND(100.0 * SUM(has_issues) / COUNT(*), 1) AS issue_pct, COUNT(DISTINCT log_date) AS days
FROM softservices_logs WHERE log_date >= date(date('now','+2 hours'), '-29 days') GROUP BY flagship, company ORDER BY flagship, company);
SELECT COUNT(*) AS n FROM (SELECT log_date, log_time, flagship, company, room_name, supervisor, cleaning_issues, comments
FROM softservices_logs WHERE has_issues = 1 AND log_date >= date(date('now','+2 hours'), '-6 days') ORDER BY log_date DESC, log_time DESC);
SELECT COUNT(*) AS n FROM (SELECT report_date, flagship, report_type, status, email_to, sent_at
FROM shift_reports WHERE report_date >= date(date('now','+2 hours'), '-6 days') ORDER BY report_date DESC, flagship, report_type);
SELECT COUNT(*) AS n FROM (SELECT report_date, flagship, report_type, email_to, subject, sent_at
FROM shift_reports WHERE status = 'failed' AND report_date >= date(date('now','+2 hours'), '-29 days') ORDER BY report_date DESC);
SELECT COUNT(*) AS n FROM (SELECT created_at, kind, to_list, subject, status, tries, last_error FROM email_outbox WHERE status <> 'sent' ORDER BY created_at DESC);